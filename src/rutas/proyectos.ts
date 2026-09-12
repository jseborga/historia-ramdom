import { createReadStream } from "node:fs";
import { stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { rutaVideo, crearCarpetaProyecto, rutaSubidaSegura, listarMusica } from "../almacen.js";
import { PRESETS } from "../render/presets.js";
import { tieneAudio } from "../render/ffmpeg.js";
import { fuentesDisponibles, archivoDeFuente } from "../render/fuentes.js";
import { GuionSchema, generarKeywords } from "../servicios/guion.js";
import { elegirClips } from "../servicios/clips.js";
import {
  ProyectoSchema,
  lineaDeTiempoDesdeGuion,
  escenaVacia,
  duracionTotal,
  VOZ_IA_POR_DEFECTO,
  type Escena,
} from "../servicios/proyecto.js";
import type { EscenaPreparada } from "../servicios/clips.js";
import { encolarProyecto } from "../cola/cola.js";

const idParam = z.object({ id: z.string().uuid() });

/** 40 MB: de sobra para una voz en off o una pista de musica. */
const MAX_SUBIDA = 40 * 1024 * 1024;
const EXTENSIONES = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;

export async function rutasProyectos(app: FastifyInstance) {
  app.get("/api/presets", async () => PRESETS);

  /** Tipografias instaladas: nombre para libass y archivo para la vista previa. */
  app.get("/api/fuentes", async () =>
    (await fuentesDisponibles()).map(({ id, nombre, estilo }) => ({ id, nombre, estilo })),
  );

  app.get("/api/fuentes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/) }).parse(req.params);
    const archivo = await archivoDeFuente(id);
    if (!archivo) return reply.code(404).send({ error: "Fuente desconocida" });
    reply.header("Content-Type", "font/ttf").header("Cache-Control", "public, max-age=604800");
    return reply.send(createReadStream(archivo));
  });

  app.get("/api/proyectos", async () =>
    db.proyecto.findMany({
      orderBy: { editadoEn: "desc" },
      take: 100,
      select: {
        id: true,
        nombre: true,
        formato: true,
        estado: true,
        archivo: true,
        duracionSeg: true,
        error: true,
        historiaId: true,
        editadoEn: true,
      },
    }),
  );

  app.get("/api/proyectos/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "No encontrado" });
    return { ...p, musicaDisponible: await listarMusica(), fuentes: await fuentesDisponibles() };
  });

  /**
   * Crea un proyecto. Desde una historia se monta la linea de tiempo con sus
   * escenas y sus clips ya elegidos, para abrir el editor con algo montado.
   */
  app.post("/api/proyectos", async (req, reply) => {
    const { historiaId, nombre, formato } = z
      .object({
        historiaId: z.string().uuid().nullable().default(null),
        nombre: z.string().min(1).max(120).optional(),
        formato: z.string().max(40).optional(),
      })
      .parse(req.body ?? {});

    let escenas: Escena[] = [escenaVacia(), escenaVacia(), escenaVacia()];
    let titulo = nombre ?? "Proyecto sin titulo";

    if (historiaId) {
      const h = await db.historia.findUnique({ where: { id: historiaId } });
      if (!h) return reply.code(404).send({ error: "La historia no existe" });
      const guion = GuionSchema.safeParse(h.guion);
      if (!guion.success) {
        return reply.code(409).send({ error: "La historia todavia no tiene guion" });
      }
      const preparadas = (h.escenas as EscenaPreparada[] | null) ?? [];
      escenas = lineaDeTiempoDesdeGuion(
        guion.data,
        preparadas.map((e) => e?.clip ?? null),
      );
      titulo = nombre ?? guion.data.titulo;
    }

    const datos = ProyectoSchema.parse({
      nombre: titulo,
      formato: formato ?? "tiktok",
      escenas,
      voz: { modo: "ia", config: VOZ_IA_POR_DEFECTO },
      musica: {},
    });

    const proyecto = await db.proyecto.create({
      data: {
        historiaId,
        nombre: datos.nombre,
        formato: datos.formato,
        escenas: datos.escenas,
        voz: datos.voz,
        musica: datos.musica,
      },
    });
    await crearCarpetaProyecto(proyecto.id);
    return reply.code(201).send(proyecto);
  });

  /** Guarda la linea de tiempo completa. El editor manda el proyecto entero. */
  app.put("/api/proyectos/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = ProyectoSchema.parse(req.body);
    return db.proyecto.update({
      where: { id },
      data: {
        nombre: datos.nombre,
        formato: datos.formato,
        escenas: datos.escenas,
        voz: datos.voz,
        musica: datos.musica,
      },
    });
  });

  app.delete("/api/proyectos/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await db.proyecto.delete({ where: { id } });
    return { ok: true };
  });

  /**
   * Sube una pista de voz o de musica propia. El nombre lo genera el servidor
   * y el archivo se valida con ffprobe: si no trae audio, se borra.
   */
  app.post("/api/proyectos/:id/subir", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await db.proyecto.findUniqueOrThrow({ where: { id } });

    const archivo = await req.file({ limits: { fileSize: MAX_SUBIDA } });
    if (!archivo) return reply.code(400).send({ error: "No llego ningun archivo" });
    if (!EXTENSIONES.test(archivo.filename ?? "")) {
      return reply.code(415).send({ error: "Formato no admitido: usa mp3, m4a, wav, ogg o aac" });
    }

    const extension = (EXTENSIONES.exec(archivo.filename)?.[1] ?? "mp3").toLowerCase();
    const nombre = `${randomUUID()}.${extension}`;
    const destino = rutaSubidaSegura(id, nombre);

    const datos = await archivo.toBuffer().catch(() => null);
    if (!datos) {
      return reply.code(413).send({ error: "El archivo supera los 40 MB" });
    }
    await crearCarpetaProyecto(id);
    await writeFile(destino, datos);

    if (!(await tieneAudio(destino))) {
      await unlink(destino).catch(() => {});
      return reply.code(415).send({ error: "El archivo no contiene ninguna pista de audio" });
    }

    return reply.code(201).send({ archivo: nombre });
  });

  /**
   * Busca automaticamente un clip parecido a cada escena: saca palabras clave
   * visuales del texto (con el LLM si hay, si no por heuristica) y elige un
   * clip por escena sin descargar nada. Por defecto solo rellena las vacias.
   */
  app.post("/api/proyectos/:id/clips-automaticos", async (req) => {
    const { id } = idParam.parse(req.params);
    const { escenas, soloVacias, idioma } = z
      .object({
        escenas: z.array(z.object({ id: z.string(), texto: z.string(), tieneClip: z.boolean() })).max(60),
        soloVacias: z.boolean().default(true),
        idioma: z.enum(["es", "en"]).default("es"),
      })
      .parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });

    const objetivo = escenas.filter((e) => e.texto.trim() && (!soloVacias || !e.tieneClip));
    if (!objetivo.length) return { clips: {}, keywords: {} };

    const keywords = await generarKeywords(objetivo.map((e) => e.texto), idioma);
    const usados = new Set<string>();
    const elegidos = await elegirClips(keywords.map((k) => ({ keywords: k })), usados);

    return {
      clips: Object.fromEntries(objetivo.map((e, i) => [e.id, elegidos[i]])),
      keywords: Object.fromEntries(objetivo.map((e, i) => [e.id, keywords[i]])),
    };
  });

  app.post("/api/proyectos/:id/render", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    const escenas = z.array(z.any()).parse(p.escenas);
    if (!escenas.length) return reply.code(409).send({ error: "El proyecto no tiene escenas" });

    const job = await encolarProyecto(id);
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });

  /** Reproduccion y descarga del MP4 del proyecto, con soporte de Range. */
  for (const [ruta, enLinea] of [
    ["/api/proyectos/:id/ver", true],
    ["/api/proyectos/:id/descargar", false],
  ] as const) {
    app.get(ruta, async (req, reply) => {
      const { id } = idParam.parse(req.params);
      const p = await db.proyecto.findUnique({ where: { id } });
      if (!p?.archivo) return reply.code(404).send({ error: "El video todavia no esta listo" });

      const archivo = rutaVideo(p.id);
      const info = await stat(archivo).catch(() => null);
      if (!info) return reply.code(404).send({ error: "El archivo ya no esta en el servidor" });

      reply.header("Content-Type", "video/mp4").header("Accept-Ranges", "bytes");
      if (!enLinea) {
        reply.header(
          "Content-Disposition",
          `attachment; filename="proyecto-${p.id.slice(0, 8)}.mp4"`,
        );
      }

      const rango = enLinea ? /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "") : null;
      if (!rango) {
        reply.header("Content-Length", info.size);
        return reply.send(createReadStream(archivo));
      }

      const inicio = rango[1] ? Number(rango[1]) : 0;
      const fin = rango[2] ? Math.min(Number(rango[2]), info.size - 1) : info.size - 1;
      if (inicio >= info.size || fin < inicio) {
        return reply
          .code(416)
          .header("Content-Range", `bytes */${info.size}`)
          .send({ error: "Rango invalido" });
      }
      reply
        .code(206)
        .header("Content-Range", `bytes ${inicio}-${fin}/${info.size}`)
        .header("Content-Length", fin - inicio + 1);
      return reply.send(createReadStream(archivo, { start: inicio, end: fin }));
    });
  }

  /** Duracion estimada, para avisar si se pasa de lo que recomienda la red. */
  app.post("/api/proyectos/:id/duracion", async (req) => {
    const escenas = z.array(z.object({ duracion: z.number() })).parse(req.body);
    return { segundos: duracionTotal(escenas as Escena[]) };
  });
}
