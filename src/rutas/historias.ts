import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { rutaVideo } from "../almacen.js";
import { generarGuion, GuionSchema, MOTORES } from "../servicios/guion.js";
import { VozSchema } from "../servicios/voz.js";
import { buscarClips, creditosDe, type EscenaPreparada } from "../servicios/clips.js";
import {
  guionATexto,
  textoAGuion,
  INSTRUCCIONES_IA,
} from "../servicios/guionTexto.js";
import { cola, encolarHistoriaSuelta } from "../cola/cola.js";
import { retrasoHasta } from "../cola/trabajos.js";

const idParam = z.object({ id: z.string().uuid() });

/** Fecha ISO futura para programar una subida. */
const fechaFutura = z
  .string()
  .datetime({ offset: true })
  .refine((v) => new Date(v).getTime() > Date.now() - 60_000, "La fecha ya paso");

const PeticionGuionSchema = z.object({
  motor: z.enum(MOTORES).default("groq"),
  modelo: z.string().max(80).nullable().default(null),
  tipo: z.enum(["Reflexion", "Historia"]),
  tema: z.string().max(200).optional(),
  idioma: z.enum(["es", "en"]).default("es"),
  duracion: z.number().int().min(15).max(180).default(65),
  evitar: z.array(z.string().max(160)).max(20).default([]),
});

/** Clip elegido a mano: { "0": "pexels-123" }. La clave es el indice de escena. */
const ClipsElegidosSchema = z
  .record(z.string().regex(/^\d+$/), z.string().max(60))
  .default({})
  .transform((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), v])));

const HistoriaSueltaSchema = PeticionGuionSchema.extend({
  voz: VozSchema,
  modoAudio: z.enum(["VOZ", "MUSICA", "MUDO"]).default("VOZ"),
  segundosEscena: z.number().min(1).max(30).nullable().default(null),
  musica: z.string().max(120).nullable().default(null),
  modoPublicacion: z.enum(["DESCARGA", "BORRADOR_TIKTOK", "DIRECTO_TIKTOK"]).default("DESCARGA"),
  guion: GuionSchema.optional(),
  ideaId: z.string().uuid().nullable().default(null),
  clipsElegidos: ClipsElegidosSchema,
  publicarEn: fechaFutura.nullable().default(null),
});

export async function rutasHistorias(app: FastifyInstance) {
  /** Vista previa del guion para el editor, sin gastar voz ni render. */
  app.post("/api/guion", async (req) => {
    const p = PeticionGuionSchema.parse(req.body);
    return generarGuion(p);
  });

  /**
   * El guion como texto plano, para llevarlo a otra IA o reescribirlo a mano.
   */
  app.post("/api/guion/texto", async (req) => {
    const { guion } = z.object({ guion: GuionSchema }).parse(req.body);
    return { texto: guionATexto(guion), instrucciones: INSTRUCCIONES_IA };
  });

  /** Devuelve el guion editado por fuera convertido de vuelta a su estructura. */
  app.post("/api/guion/desde-texto", async (req, reply) => {
    const { texto } = z.object({ texto: z.string().min(20).max(20_000) }).parse(req.body);
    try {
      return textoAGuion(texto);
    } catch (err) {
      return reply
        .code(400)
        .send({ error: err instanceof Error ? err.message : "Texto no reconocido" });
    }
  });

  app.get("/api/historias", async (req) => {
    const { serieId, limite } = z
      .object({
        serieId: z.string().uuid().optional(),
        limite: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);

    return db.historia.findMany({
      where: serieId ? { serieId } : {},
      orderBy: { creadaEn: "desc" },
      take: limite,
      select: {
        id: true,
        serieId: true,
        estado: true,
        titulo: true,
        ganchoTexto: true,
        metrica: { select: { vistas: true, likes: true, puntuacion: true, tiempoPromedioSeg: true } },
        descripcion: true,
        archivo: true,
        publishId: true,
        publicarEn: true,
        error: true,
        creadaEn: true,
      },
    });
  });

  app.get("/api/historias/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const h = await db.historia.findUnique({ where: { id } });
    if (!h) return reply.code(404).send({ error: "No encontrada" });
    return h;
  });

  /** Guion de una historia ya creada, en texto plano. */
  app.get("/api/historias/:id/texto", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const h = await db.historia.findUnique({ where: { id }, select: { guion: true } });
    if (!h?.guion) return reply.code(404).send({ error: "La historia no tiene guion" });
    const guion = GuionSchema.safeParse(h.guion);
    if (!guion.success) return reply.code(409).send({ error: "El guion guardado no es legible" });
    return { texto: guionATexto(guion.data), instrucciones: INSTRUCCIONES_IA };
  });

  /** Creditos de los clips, para pegarlos aparte en TikTok. */
  app.get("/api/historias/:id/creditos", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const h = await db.historia.findUnique({ where: { id }, select: { escenas: true } });
    if (!h) return reply.code(404).send({ error: "No encontrada" });
    const escenas = (h.escenas as EscenaPreparada[] | null) ?? [];
    return { creditos: creditosDe(escenas) };
  });

  /** Encola una historia suelta (editor manual, sin serie). */
  app.post("/api/historias", async (req, reply) => {
    const p = HistoriaSueltaSchema.parse(req.body);
    const job = await encolarHistoriaSuelta({
      tipo: p.tipo,
      tema: p.tema,
      duracion: p.duracion,
      idioma: p.idioma,
      motor: p.motor,
      modelo: p.modelo,
      voz: p.voz,
      modoAudio: p.modoAudio,
      segundosEscena: p.segundosEscena,
      musica: p.musica,
      modoPublicacion: p.modoPublicacion,
      guion: p.guion,
      ideaId: p.ideaId,
      clipsElegidos: p.clipsElegidos,
      publicarEn: p.publicarEn,
      evitarTitulos: p.evitar,
    });
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });

  /** Sube a TikTok ahora o a la hora indicada en `publicarEn`. */
  app.post("/api/historias/:id/publicar", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { publicarEn } = z
      .object({ publicarEn: fechaFutura.nullable().default(null) })
      .parse(req.body ?? {});

    const h = await db.historia.findUnique({ where: { id } });
    if (!h?.archivo) return reply.code(409).send({ error: "El video todavia no esta listo" });

    const delay = retrasoHasta(publicarEn);
    const job = await cola.add(
      "publicar",
      { historiaId: id },
      { delay, attempts: 3, backoff: { type: "exponential", delay: 120_000 } },
    );
    await db.historia.update({
      where: { id },
      data: { publicarEn: publicarEn ? new Date(publicarEn) : null },
    });

    return reply.code(202).send({ encolada: true, jobId: job.id, publicarEn, delay });
  });

  /**
   * Candidatos de clip para unas keywords, con su fotograma de muestra.
   * Sirve para elegir a mano antes de producir el video.
   */
  app.get("/api/clips", async (req) => {
    const { keywords } = z
      .object({ keywords: z.string().min(1).max(200) })
      .parse(req.query);

    const lista = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 3);

    const resultados = await Promise.all(lista.map((k) => buscarClips(k)));
    // Sin repetir: la misma keyword en dos escenas puede traer los mismos.
    const unicos = new Map<string, (typeof resultados)[0][0]>();
    for (const clip of resultados.flat()) unicos.set(clip.id, clip);
    return [...unicos.values()].slice(0, 24);
  });

  /**
   * Reproduccion en el navegador antes de descargar. Admite `Range` para que
   * el reproductor pueda saltar por el video sin traerselo entero.
   */
  app.get("/api/historias/:id/ver", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const h = await db.historia.findUnique({ where: { id } });
    if (!h?.archivo) return reply.code(404).send({ error: "El video todavia no esta listo" });

    const ruta = rutaVideo(h.id);
    const info = await stat(ruta).catch(() => null);
    if (!info) return reply.code(404).send({ error: "El archivo ya no esta en el servidor" });

    reply.header("Content-Type", "video/mp4").header("Accept-Ranges", "bytes");

    const rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (!rango) {
      reply.header("Content-Length", info.size);
      return reply.send(createReadStream(ruta));
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
    return reply.send(createReadStream(ruta, { start: inicio, end: fin }));
  });

  /**
   * Descarga protegida por la sesion. La ruta del archivo se arma con el ID
   * de la base de datos, nunca con texto que envie el usuario.
   */
  app.get("/api/historias/:id/descargar", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const h = await db.historia.findUnique({ where: { id } });
    if (!h?.archivo) return reply.code(404).send({ error: "El video todavia no esta listo" });

    const ruta = rutaVideo(h.id);
    const info = await stat(ruta).catch(() => null);
    if (!info) return reply.code(404).send({ error: "El archivo ya no esta en el servidor" });

    reply
      .header("Content-Type", "video/mp4")
      .header("Content-Length", info.size)
      .header("Content-Disposition", `attachment; filename="historia-${h.id.slice(0, 8)}.mp4"`);
    return reply.send(createReadStream(ruta));
  });

  app.delete("/api/historias/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await db.historia.delete({ where: { id } });
    return { ok: true };
  });
}
