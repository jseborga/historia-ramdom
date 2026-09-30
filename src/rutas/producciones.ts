import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { env, MAX_CLIP_BYTES } from "../env.js";
import { listarMusica, rutaMedioSeguro, rutaMiniaturas } from "../almacen.js";
import { ffmpeg } from "../render/ffmpeg.js";
import { IdiomaCampo, MOTORES } from "../servicios/guion.js";
import { descargarDeEnlace, type Descargado } from "../servicios/enlaces.js";
import { EXT_IMAGEN, EXT_VIDEO, borrarMedio, guardarSubida } from "../servicios/medios.js";
import {
  DURACIONES,
  MAX_REFERENCIAS,
  NOMBRES_PARTE,
  OBRAS,
  PALABRAS_POR_PLANO,
  PARTES,
  crearProduccion,
  generarTrailer,
  lineasDe,
  montarProduccion,
  promptImagen,
  promptVeo,
} from "../servicios/produccion.js";
import { conMotivo } from "./errores.js";

/**
 * Producciones: el tráiler de una obra que no existe, generado con Veo fuera
 * de la app y montado dentro.
 *
 * Aquí no se llama a Veo. La app escribe los prompts, guarda las imágenes de
 * referencia y los vídeos que se suben, lleva la cuenta de qué plano está en
 * qué punto —la producción dura días— y monta lo que haya cuando se pida.
 */

const idParam = z.object({ id: z.string().uuid() });
const hijoParam = z.object({ id: z.string().uuid(), hijo: z.string().uuid() });

const PeticionSchema = z.object({
  idea: z.string().min(10).max(2000),
  obra: z.enum(OBRAS).default("pelicula"),
  genero: z.string().max(80).default(""),
  duracion: z.union([z.literal(30), z.literal(60), z.literal(90)]).default(60),
  formato: z.string().max(40).default("tiktok"),
  idioma: IdiomaCampo.default("es"),
  motor: z.enum(MOTORES).default("gemini"),
  modelo: z.string().max(80).nullable().default(null),
});

const EnlaceSchema = z.object({ enlace: z.string().trim().min(8).max(2000) });

const LineaSchema = z.object({ personajeId: z.string().max(60), texto: z.string().max(300) });

const PlanoCambio = z
  .object({
    parte: z.enum(PARTES),
    tipo: z.enum(["veo", "carton"]),
    duracion: z.number().int().min(1).max(8),
    accion: z.string().max(800),
    camara: z.string().max(300),
    sonido: z.string().max(300),
    dialogo: z.array(LineaSchema).max(3),
    personajes: z.array(z.string().uuid()).max(MAX_REFERENCIAS),
    continua: z.boolean(),
    rotulo: z.string().max(80),
    momentoTrailer: z.boolean(),
    estado: z.enum(["PENDIENTE", "PROMPT_COPIADO", "SUBIDO", "APROBADO", "REGENERAR"]),
    nota: z.string().max(500),
  })
  .partial();

const PersonajeCambio = z
  .object({
    nombre: z.string().min(1).max(40),
    papel: z.string().max(200),
    ficha: z.string().max(600),
    voz: z.string().max(300),
  })
  .partial();

/** La producción entera, con los prompts ya armados para copiar. */
async function completa(id: string) {
  const pr = await db.produccion.findUniqueOrThrow({
    where: { id },
    include: { personajes: { orderBy: { orden: "asc" } }, planos: { orderBy: { orden: "asc" } } },
  });
  return {
    ...pr,
    personajes: pr.personajes.map((p) => ({ ...p, promptImagen: promptImagen(pr, p) })),
    planos: pr.planos.map((p, i) => {
      const lineas = lineasDe(p.dialogo);
      const palabras = lineas.reduce((n, l) => n + l.texto.trim().split(/\s+/).filter(Boolean).length, 0);
      const avisos: string[] = [];
      if (p.tipo === "veo") {
        if (palabras > PALABRAS_POR_PLANO) {
          avisos.push(`${palabras} palabras de diálogo: en ${p.duracion} s caben unas ${PALABRAS_POR_PLANO} dichas con calma.`);
        }
        if (p.personajes.length && p.duracion !== 8) avisos.push("Con imágenes de referencia, Veo solo genera planos de 8 s.");
        if (!(DURACIONES as readonly number[]).includes(p.duracion)) avisos.push("Veo genera 4, 6 u 8 s.");
        if (p.continua && i === 0) avisos.push("Es el primer plano: no hay de dónde continuar.");
        const sinImagen = p.personajes.filter((pid) => !pr.personajes.find((x) => x.id === pid)?.medioId);
        if (sinImagen.length) avisos.push("Falta la imagen de referencia de algún personaje de este plano.");
      }
      // De dónde sale el primer fotograma, si continúa: el vídeo del anterior.
      const anterior = i > 0 ? pr.planos[i - 1] : undefined;
      return {
        ...p,
        numero: i + 1,
        nombreParte: NOMBRES_PARTE[p.parte as keyof typeof NOMBRES_PARTE] ?? p.parte,
        promptVeo: promptVeo(pr, p, pr.personajes),
        palabras,
        avisos,
        primerFotograma: p.continua && anterior?.medioId ? `/api/producciones/${pr.id}/planos/${anterior.id}/ultimo-fotograma` : null,
      };
    }),
  };
}

/** El archivo que llega en un multipart, ya en memoria, o el motivo de que no. */
async function recibir(
  req: FastifyRequest,
  extension: RegExp,
): Promise<{ error: string; codigo: number } | { datos: Buffer; nombre: string }> {
  const subido = await req.file({ limits: { fileSize: MAX_CLIP_BYTES } });
  if (!subido) return { error: "No llegó ningún archivo", codigo: 400 };
  const nombre = subido.filename ?? "";
  if (!extension.test(nombre)) return { error: "Formato no admitido para esto", codigo: 415 };
  const datos = await subido.toBuffer().catch(() => null);
  if (!datos) return { error: `El archivo supera los ${env.MAX_CLIP_MB} MB`, codigo: 413 };
  return { datos, nombre };
}

export async function rutasProducciones(app: FastifyInstance) {
  app.get("/api/producciones", async () =>
    db.produccion.findMany({
      orderBy: { creadaEn: "desc" },
      take: 100,
      include: { _count: { select: { planos: true, personajes: true } }, planos: { select: { estado: true, tipo: true } } },
    }),
  );

  app.get("/api/producciones/:id", async (req) => completa(idParam.parse(req.params).id));

  /** Escribe el tráiler con la IA y lo guarda: biblia, personajes y planos. */
  app.post("/api/producciones", async (req, reply) => {
    const p = PeticionSchema.parse(req.body);
    return conMotivo(reply, async () => {
      const { trailer, informe } = await generarTrailer(p);
      const pr = await crearProduccion(p, trailer);
      return { ...(await completa(pr.id)), motorUsado: informe.motor, avisoMotor: informe.aviso };
    });
  });

  app.put("/api/producciones/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const d = z
      .object({
        titulo: z.string().min(1).max(120),
        logline: z.string().max(400),
        genero: z.string().max(80),
        estilo: z.string().max(800),
        formato: z.string().max(40),
        idioma: IdiomaCampo,
      })
      .partial()
      .parse(req.body);
    await db.produccion.update({ where: { id }, data: d });
    return completa(id);
  });

  app.delete("/api/producciones/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    // Los vídeos y las imágenes se quedan en la Galería: son material, y
    // borrarlos por borrar la producción sería perder días de generación.
    await db.produccion.delete({ where: { id } });
    return { ok: true };
  });

  // ---- Personajes ----

  app.post("/api/producciones/:id/personajes", async (req) => {
    const { id } = idParam.parse(req.params);
    const d = PersonajeCambio.required({ nombre: true }).parse(req.body);
    const orden = await db.personaje.count({ where: { produccionId: id } });
    await db.personaje.create({ data: { produccionId: id, orden, ...d } });
    return completa(id);
  });

  app.put("/api/producciones/:id/personajes/:hijo", async (req) => {
    const { id, hijo } = hijoParam.parse(req.params);
    await db.personaje.update({ where: { id: hijo, produccionId: id }, data: PersonajeCambio.parse(req.body) });
    return completa(id);
  });

  app.delete("/api/producciones/:id/personajes/:hijo", async (req) => {
    const { id, hijo } = hijoParam.parse(req.params);
    await db.personaje.delete({ where: { id: hijo, produccionId: id } });
    // Y fuera de los planos donde salía, que si no pedirían una referencia que ya no existe.
    const planos = await db.plano.findMany({ where: { produccionId: id, personajes: { has: hijo } } });
    for (const p of planos) {
      await db.plano.update({
        where: { id: p.id },
        data: {
          personajes: p.personajes.filter((x) => x !== hijo),
          dialogo: lineasDe(p.dialogo).filter((l) => l.personajeId !== hijo),
        },
      });
    }
    return completa(id);
  });

  /** La imagen de referencia del personaje: a la Galería, y enlazada a él. */
  async function ponerImagen(id: string, hijo: string, r: Descargado, reply: FastifyReply) {
    const pr = await db.produccion.findUniqueOrThrow({ where: { id } });
    const pj = await db.personaje.findFirstOrThrow({ where: { id: hijo, produccionId: id } });
    if (!EXT_IMAGEN.test(r.nombre)) return reply.code(415).send({ error: "Eso no es una imagen (jpg, png o webp)" });
    const g = await guardarSubida(r.datos, `${pj.nombre} - ${r.nombre}`, [pr.titulo.toLowerCase(), pj.nombre.toLowerCase(), "personaje"]);
    if (!g.ok) return reply.code(415).send({ error: g.mensaje });
    if (g.medio.clase !== "IMAGEN") {
      await borrarMedio(g.medio.id);
      return reply.code(415).send({ error: "Eso no es una imagen" });
    }
    await db.personaje.update({ where: { id: hijo }, data: { medioId: g.medio.id } });
    return completa(id);
  }

  app.post("/api/producciones/:id/personajes/:hijo/imagen", async (req, reply) => {
    const { id, hijo } = hijoParam.parse(req.params);
    await db.personaje.findFirstOrThrow({ where: { id: hijo, produccionId: id } });
    const r = await recibir(req, EXT_IMAGEN);
    if ("error" in r) return reply.code(r.codigo).send({ error: r.error });
    return ponerImagen(id, hijo, r, reply);
  });

  /** La misma imagen, desde un enlace (Drive, la API de Gemini o directo). */
  app.post("/api/producciones/:id/personajes/:hijo/imagen/enlace", async (req, reply) => {
    const { id, hijo } = hijoParam.parse(req.params);
    const { enlace } = EnlaceSchema.parse(req.body);
    await db.personaje.findFirstOrThrow({ where: { id: hijo, produccionId: id } });
    return conMotivo(reply, async () => ponerImagen(id, hijo, await descargarDeEnlace(enlace, "imagen"), reply));
  });

  // ---- Planos ----

  app.post("/api/producciones/:id/planos", async (req) => {
    const { id } = idParam.parse(req.params);
    const d = PlanoCambio.parse(req.body ?? {});
    const orden = await db.plano.count({ where: { produccionId: id } });
    await db.plano.create({ data: { produccionId: id, orden, parte: "escalada", ...d } });
    return completa(id);
  });

  app.put("/api/producciones/:id/planos/:hijo", async (req) => {
    const { id, hijo } = hijoParam.parse(req.params);
    await db.plano.update({ where: { id: hijo, produccionId: id }, data: PlanoCambio.parse(req.body) });
    return completa(id);
  });

  app.delete("/api/producciones/:id/planos/:hijo", async (req) => {
    const { id, hijo } = hijoParam.parse(req.params);
    await db.plano.delete({ where: { id: hijo, produccionId: id } });
    return completa(id);
  });

  /** El nuevo orden de los planos: la lista entera de ids. */
  app.post("/api/producciones/:id/planos/orden", async (req) => {
    const { id } = idParam.parse(req.params);
    const { ids } = z.object({ ids: z.array(z.string().uuid()).max(60) }).parse(req.body);
    await db.$transaction(ids.map((pid, orden) => db.plano.update({ where: { id: pid, produccionId: id }, data: { orden } })));
    return completa(id);
  });

  /** El vídeo que salió de Veo: a la Galería y al plano, que pasa a "subido". */
  async function ponerVideo(id: string, hijo: string, r: Descargado, reply: FastifyReply) {
    const pr = await db.produccion.findUniqueOrThrow({ where: { id } });
    const plano = await db.plano.findFirstOrThrow({ where: { id: hijo, produccionId: id } });
    if (!EXT_VIDEO.test(r.nombre)) return reply.code(415).send({ error: "Eso no es un vídeo (mp4, mov, m4v o webm)" });
    // El nombre con la extensión del original: es lo que dice qué es.
    const ext = /\.[a-z0-9]+$/i.exec(r.nombre)?.[0] ?? ".mp4";
    const g = await guardarSubida(r.datos, `${pr.titulo} - plano ${plano.orden + 1}${ext}`, [
      pr.titulo.toLowerCase(),
      plano.parte,
      "veo",
    ]);
    if (!g.ok) return reply.code(415).send({ error: g.mensaje });
    if (g.medio.clase !== "VIDEO") {
      await borrarMedio(g.medio.id);
      return reply.code(415).send({ error: "Eso no es un vídeo" });
    }
    await db.plano.update({ where: { id: hijo }, data: { medioId: g.medio.id, estado: "SUBIDO" } });
    return completa(id);
  }

  app.post("/api/producciones/:id/planos/:hijo/video", async (req, reply) => {
    const { id, hijo } = hijoParam.parse(req.params);
    await db.plano.findFirstOrThrow({ where: { id: hijo, produccionId: id } });
    const r = await recibir(req, EXT_VIDEO);
    if ("error" in r) return reply.code(r.codigo).send({ error: r.error });
    return ponerVideo(id, hijo, r, reply);
  });

  /**
   * El vídeo desde un enlace: Drive compartido, el archivo que deja la API de
   * Gemini o un enlace directo. Se baja aquí y se guarda como si se hubiera
   * subido; el plano no se queda con el enlace, que caduca.
   */
  app.post("/api/producciones/:id/planos/:hijo/video/enlace", async (req, reply) => {
    const { id, hijo } = hijoParam.parse(req.params);
    const { enlace } = EnlaceSchema.parse(req.body);
    await db.plano.findFirstOrThrow({ where: { id: hijo, produccionId: id } });
    return conMotivo(reply, async () => ponerVideo(id, hijo, await descargarDeEnlace(enlace, "video"), reply));
  });

  /**
   * El último fotograma del vídeo de un plano, para generar el siguiente
   * desde ahí (el "primer fotograma" de Veo). Es lo que hace que dos planos
   * seguidos empalmen sin que la escena salte.
   */
  app.get("/api/producciones/:id/planos/:hijo/ultimo-fotograma", async (req, reply) => {
    const { id, hijo } = hijoParam.parse(req.params);
    const plano = await db.plano.findFirstOrThrow({ where: { id: hijo, produccionId: id } });
    const medio = plano.medioId ? await db.medio.findUnique({ where: { id: plano.medioId } }) : null;
    if (!medio || medio.clase !== "VIDEO") return reply.code(404).send({ error: "Ese plano todavía no tiene vídeo" });
    const destino = join(rutaMiniaturas(), `${medio.id}-ultimo.jpg`);
    if (!(await stat(destino).then((x) => x.size > 0, () => false))) {
      await ffmpeg(
        ["-sseof", "-0.1", "-i", rutaMedioSeguro(medio.archivo), "-frames:v", "1", "-q:v", "2", "-update", "1", "-y", destino],
        rutaMiniaturas(),
      );
    }
    return reply
      .header("Content-Type", "image/jpeg")
      .header("Content-Disposition", `attachment; filename="plano-${plano.orden + 1}-ultimo-fotograma.jpg"`)
      .send(createReadStream(destino));
  });

  /** Monta lo que haya en un proyecto del editor: tráiler, avance o teaser. */
  app.post("/api/producciones/:id/montar", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const o = z
      .object({
        que: z.enum(["trailer", "avance", "personaje"]).default("trailer"),
        personajeId: z.string().uuid().optional(),
        musica: z.string().max(200).nullable().default(null),
        volumenMusica: z.number().min(0).max(1).default(0.35),
      })
      .parse(req.body ?? {});
    // La música, de la biblioteca de música y nada más: el nombre se busca en
    // la lista, no se usa tal cual como ruta.
    if (o.musica && !(await listarMusica()).includes(o.musica)) {
      return reply.code(404).send({ error: "Esa pista no está en la biblioteca de música" });
    }
    return conMotivo(reply, async () => {
      const proyecto = await montarProduccion(id, o);
      return reply.code(201).send(proyecto);
    });
  });
}
