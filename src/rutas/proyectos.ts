import { createReadStream } from "node:fs";
import { stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { rutaVideo, crearCarpetaProyecto, rutaSubidaSegura, listarMusica } from "../almacen.js";
import { PRESETS } from "../render/presets.js";
import { tieneAudio, duracionAudio } from "../render/ffmpeg.js";
import { fuentesDisponibles, archivoDeFuente } from "../render/fuentes.js";
import { GuionSchema, generarKeywords, escribirNarracion, guionComoNarracion } from "../servicios/guion.js";
import { ensamblarProyecto } from "../servicios/ensamblar.js";
import { elegirClips } from "../servicios/clips.js";
import {
  ProyectoSchema,
  pistasDesdeGuion,
  desdeEscenasAntiguas,
  esModeloAntiguo,
  clipVacio,
  textosDesdeNarracion,
  duracionVideo,
  duracionProyecto,
  creditosDeProyecto,
  descripcionDeProyecto,
  VOZ_IA_POR_DEFECTO,
  type ClipPista,
  type RotuloPista,
  type VozPista,
} from "../servicios/proyecto.js";
import { generarNarracion } from "../servicios/narracion.js";
import type { EscenaPreparada } from "../servicios/clips.js";
import { encolarProyecto } from "../cola/cola.js";
import { importarSunoAProyecto, creditoMusica } from "../servicios/suno.js";

const idParam = z.object({ id: z.string().uuid() });

/** 40 MB: de sobra para una voz en off o una pista de musica. */
const MAX_SUBIDA = 40 * 1024 * 1024;
const EXTENSIONES = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;

/** Lee las pistas de la fila, convirtiendo proyectos del modelo antiguo. */
function pistasDe(p: { escenas: unknown; textos: unknown }) {
  const escenas = Array.isArray(p.escenas) ? p.escenas : [];
  if (esModeloAntiguo(escenas)) return desdeEscenasAntiguas(escenas);
  return {
    video: escenas as ClipPista[],
    textos: (Array.isArray(p.textos) ? p.textos : []) as RotuloPista[],
  };
}

/**
 * Sirve un archivo con soporte de Range (el reproductor salta sin bajarlo
 * entero). Con `descarga` lo manda como adjunto.
 */
async function servir(
  req: FastifyRequest,
  reply: FastifyReply,
  ruta: string,
  tipo: string,
  descarga?: string,
) {
  const info = await stat(ruta).catch(() => null);
  if (!info) return reply.code(404).send({ error: "El archivo ya no esta en el servidor" });

  reply.header("Content-Type", tipo).header("Accept-Ranges", "bytes");
  if (descarga) reply.header("Content-Disposition", `attachment; filename="${descarga}"`);

  const rango = descarga ? null : /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!rango) {
    reply.header("Content-Length", info.size);
    return reply.send(createReadStream(ruta));
  }
  const inicio = rango[1] ? Number(rango[1]) : 0;
  const fin = rango[2] ? Math.min(Number(rango[2]), info.size - 1) : info.size - 1;
  if (inicio >= info.size || fin < inicio) {
    return reply.code(416).header("Content-Range", `bytes */${info.size}`).send({ error: "Rango invalido" });
  }
  reply
    .code(206)
    .header("Content-Range", `bytes ${inicio}-${fin}/${info.size}`)
    .header("Content-Length", fin - inicio + 1);
  return reply.send(createReadStream(ruta, { start: inicio, end: fin }));
}

export async function rutasProyectos(app: FastifyInstance) {
  app.get("/api/presets", async () => PRESETS);

  app.get("/api/fuentes", async () =>
    (await fuentesDisponibles()).map(({ id, nombre, estilo }) => ({ id, nombre, estilo })),
  );

  app.get("/api/fuentes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/) }).parse(req.params);
    const archivo = await archivoDeFuente(id);
    if (!archivo) return reply.code(404).send({ error: "Fuente desconocida" });
    reply.header("Cache-Control", "public, max-age=604800");
    return servir(req, reply, archivo, "font/ttf");
  });

  app.get("/api/proyectos", async () =>
    db.proyecto.findMany({
      orderBy: { editadoEn: "desc" },
      take: 100,
      select: {
        id: true, nombre: true, formato: true, estado: true, archivo: true,
        descripcion: true, duracionSeg: true, error: true, historiaId: true, editadoEn: true,
      },
    }),
  );

  app.get("/api/proyectos/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "No encontrado" });
    const { video, textos } = pistasDe(p);
    const voz = (p.voz ?? {}) as Partial<VozPista>;
    return {
      ...p,
      escenas: undefined,
      video,
      textos,
      voz: { modo: "servidor", texto: "", config: VOZ_IA_POR_DEFECTO, archivo: null,
             duracion: null, inicio: 0, huella: null, ...voz },
      musicaDisponible: await listarMusica(),
      fuentes: await fuentesDisponibles(),
    };
  });

  /**
   * Crea un proyecto. Desde una historia: clips en secuencia, un rotulo por
   * escena colocado sobre su clip, y la narracion completa en la pista de voz.
   */
  app.post("/api/proyectos", async (req, reply) => {
    const { historiaId, nombre, formato } = z
      .object({
        historiaId: z.string().uuid().nullable().default(null),
        nombre: z.string().min(1).max(120).optional(),
        formato: z.string().max(40).optional(),
      })
      .parse(req.body ?? {});

    let video: ClipPista[] = [clipVacio(), clipVacio(), clipVacio()];
    let textos: RotuloPista[] = [];
    let narracion = "";
    let titulo = nombre ?? "Proyecto sin titulo";

    if (historiaId) {
      const h = await db.historia.findUnique({ where: { id: historiaId } });
      if (!h) return reply.code(404).send({ error: "La historia no existe" });
      const guion = GuionSchema.safeParse(h.guion);
      if (!guion.success) return reply.code(409).send({ error: "La historia todavia no tiene guion" });
      const preparadas = (h.escenas as EscenaPreparada[] | null) ?? [];
      const pistas = pistasDesdeGuion(guion.data, preparadas.map((e) => e?.clip ?? null));
      video = pistas.video;
      textos = pistas.textos;
      narracion = pistas.narracion;
      titulo = nombre ?? guion.data.titulo;
    }

    const datos = ProyectoSchema.parse({
      nombre: titulo,
      formato: formato ?? "tiktok",
      video,
      textos,
      voz: { modo: "servidor", texto: narracion, config: VOZ_IA_POR_DEFECTO },
      musica: {},
    });
    const proyecto = await db.proyecto.create({
      data: {
        historiaId, nombre: datos.nombre, formato: datos.formato,
        escenas: datos.video, textos: datos.textos, voz: datos.voz, musica: datos.musica,
      },
    });
    await crearCarpetaProyecto(proyecto.id);
    return reply.code(201).send(proyecto);
  });

  /** Guarda las tres pistas. El editor manda el proyecto entero. */
  app.put("/api/proyectos/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const d = ProyectoSchema.parse(req.body);
    return db.proyecto.update({
      where: { id },
      data: { nombre: d.nombre, formato: d.formato, escenas: d.video, textos: d.textos, voz: d.voz, musica: d.musica },
    });
  });

  app.delete("/api/proyectos/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await db.proyecto.delete({ where: { id } });
    return { ok: true };
  });

  /**
   * Genera la narracion AHORA con una sola voz y devuelve su duracion real.
   * Con la voz local tarda un segundo; es lo que permite sincronizar el resto
   * antes de renderizar nada.
   */
  app.post("/api/proyectos/:id/voz", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { voz } = z.object({ voz: ProyectoSchema.shape.voz }).parse(req.body);
    if (voz.modo !== "servidor") return reply.code(400).send({ error: "Elige 'voz del servidor'" });
    const r = await generarNarracion(id, voz);
    const nueva: VozPista = { ...voz, ...r };
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    await db.proyecto.update({ where: { id }, data: { voz: { ...(p.voz as object), ...nueva } } });
    return nueva;
  });

  /** La narracion para la vista previa, con Range. */
  app.get("/api/proyectos/:id/voz", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    const voz = p?.voz as VozPista | null;
    if (!voz?.archivo) return reply.code(404).send({ error: "Todavia no hay narracion" });
    const tipo = voz.archivo.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    return servir(req, reply, rutaSubidaSegura(id, voz.archivo), tipo);
  });

  /**
   * Redacta la narracion corrida a partir del guion de la historia (o del
   * texto actual): "plano" es texto limpio bien puntuado; "expresivo" anade
   * marcas de tono entre corchetes para Gemini. "guion" la devuelve tal cual.
   */
  app.post("/api/proyectos/:id/narracion", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { estilo, texto, idioma, region, modismos } = z
      .object({
        estilo: z.enum(["plano", "expresivo", "guion"]).default("plano"),
        texto: z.string().max(20_000).optional(),
        idioma: z.enum(["es", "en"]).default("es"),
        region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
        modismos: z.boolean().default(true),
      })
      .parse(req.body ?? {});
    const p = await db.proyecto.findUniqueOrThrow({ where: { id }, include: { historia: true } });
    const guion = p.historia ? GuionSchema.safeParse(p.historia.guion) : null;
    const fuente = texto?.trim() || (guion?.success ? guionComoNarracion(guion.data) : ((p.voz as VozPista | null)?.texto ?? ""));
    if (!fuente.trim()) return reply.code(409).send({ error: "No hay guion ni texto del que partir" });
    if (estilo === "guion") return { narracion: fuente };
    return { narracion: await escribirNarracion(fuente, estilo, idioma, null, region, modismos) };
  });

  /** Ensambla el proyecto entero con la narracion al mando. */
  app.post("/api/proyectos/:id/ensamblar", async (req) => {
    const { id } = idParam.parse(req.params);
    const opciones = z
      .object({
        preferirLargos: z.boolean().default(true),
        ganchoSeg: z.number().min(2).max(10).default(4),
        lectura: z.enum(["frases", "bloques"]).default("frases"),
        animacion: z.enum(["fundido", "resaltar", "ninguna"]).default("fundido"),
      })
      .parse(req.body ?? {});
    return ensamblarProyecto(id, opciones);
  });

  /** Rotulos frase a frase repartidos sobre la narracion (o sobre los clips). */
  app.post("/api/proyectos/:id/textos-desde-voz", async (req) => {
    const { id } = idParam.parse(req.params);
    const { voz, video, lectura } = z
      .object({
        voz: ProyectoSchema.shape.voz,
        video: ProyectoSchema.shape.video,
        lectura: z.enum(["frases", "bloques"]).default("frases"),
      })
      .parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });
    return textosDesdeNarracion(voz, duracionVideo(video), lectura);
  });

  /**
   * Un clip parecido a cada texto: palabras clave visuales (LLM o heuristica)
   * y eleccion sin descargar. El cliente manda, por clip, el texto que le cae
   * encima en la linea de tiempo.
   */
  app.post("/api/proyectos/:id/clips-automaticos", async (req) => {
    const { id } = idParam.parse(req.params);
    const { escenas, soloVacias, idioma } = z
      .object({
        escenas: z.array(z.object({ id: z.string(), texto: z.string(), tieneClip: z.boolean() })).max(120),
        soloVacias: z.boolean().default(true),
        idioma: z.enum(["es", "en"]).default("es"),
      })
      .parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });

    const objetivo = escenas.filter((e) => e.texto.trim() && (!soloVacias || !e.tieneClip));
    if (!objetivo.length) return { clips: {}, keywords: {} };
    const keywords = await generarKeywords(objetivo.map((e) => e.texto), idioma);
    const elegidos = await elegirClips(keywords.map((k) => ({ keywords: k })), new Set());
    return {
      clips: Object.fromEntries(objetivo.map((e, i) => [e.id, elegidos[i]])),
      keywords: Object.fromEntries(objetivo.map((e, i) => [e.id, keywords[i]])),
    };
  });

  /** Sube voz o musica propia: nombre del servidor, extension, tamano y ffprobe. */
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
    if (!datos) return reply.code(413).send({ error: "El archivo supera los 40 MB" });
    await crearCarpetaProyecto(id);
    await writeFile(destino, datos);
    if (!(await tieneAudio(destino))) {
      await unlink(destino).catch(() => {});
      return reply.code(415).send({ error: "El archivo no contiene ninguna pista de audio" });
    }
    const duracion = await duracionAudio(destino).catch(() => null);
    return reply.code(201).send({ archivo: nombre, duracion });
  });

  /**
   * Música de ambiente desde un enlace de Suno: el id se saca del enlace y se
   * descarga solo desde el CDN de Suno a la carpeta del proyecto.
   */
  app.post("/api/proyectos/:id/musica-enlace", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { url } = z.object({ url: z.string().min(10).max(400) }).parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });
    try {
      const r = await importarSunoAProyecto(id, url);
      return reply.code(201).send({ ...r, creditos: creditoMusica(r.archivo) });
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "No se pudo importar" });
    }
  });

  app.post("/api/proyectos/:id/render", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (!pistasDe(p).video.length) return reply.code(409).send({ error: "El proyecto no tiene clips" });
    const job = await encolarProyecto(id);
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });

  /**
   * Créditos y descripción del proyecto. Si aún no se renderizó, se calculan
   * de los clips actuales; el .txt se descarga con el mismo nombre que el MP4.
   */
  app.get("/api/proyectos/:id/creditos", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id }, include: { historia: true } });
    if (!p) return reply.code(404).send({ error: "No encontrado" });
    const { video } = pistasDe(p);
    const guion = p.historia ? GuionSchema.safeParse(p.historia.guion) : null;
    const musica = creditoMusica((p.musica as { archivo?: string | null } | null)?.archivo);
    const descripcion =
      p.descripcion ??
      descripcionDeProyecto(p.nombre, video, guion?.success ? guion.data.hashtags : [], guion?.success ? guion.data.gancho : null, musica);
    return { descripcion, creditos: creditosDeProyecto(video, musica) };
  });

  app.get("/api/proyectos/:id/creditos.txt", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id }, include: { historia: true } });
    if (!p) return reply.code(404).send({ error: "No encontrado" });
    const { video } = pistasDe(p);
    const guion = p.historia ? GuionSchema.safeParse(p.historia.guion) : null;
    const musica = creditoMusica((p.musica as { archivo?: string | null } | null)?.archivo);
    const descripcion =
      p.descripcion ??
      descripcionDeProyecto(p.nombre, video, guion?.success ? guion.data.hashtags : [], guion?.success ? guion.data.gancho : null, musica);
    // El .txt lleva la descripción corta para pegar y, debajo, la lista completa con enlaces.
    const texto = [descripcion, "", "Créditos completos:", creditosDeProyecto(video, musica)].join("\n");
    reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="proyecto-${p.id.slice(0, 8)}-creditos.txt"`);
    return reply.send(texto + "\n");
  });

  app.get("/api/proyectos/:id/ver", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    if (!p?.archivo) return reply.code(404).send({ error: "El video todavia no esta listo" });
    return servir(req, reply, rutaVideo(p.id), "video/mp4");
  });

  app.get("/api/proyectos/:id/descargar", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    if (!p?.archivo) return reply.code(404).send({ error: "El video todavia no esta listo" });
    return servir(req, reply, rutaVideo(p.id), "video/mp4", `proyecto-${p.id.slice(0, 8)}.mp4`);
  });

  /** Duracion total con las tres pistas, para avisar si se pasa del preset. */
  app.post("/api/proyectos/:id/duracion", async (req) => {
    const d = ProyectoSchema.pick({ video: true, textos: true, voz: true }).parse(req.body);
    return { segundos: duracionProyecto(d) };
  });
}
