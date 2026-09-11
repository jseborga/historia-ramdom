import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { rutaVideo } from "../almacen.js";
import { generarGuion, GuionSchema, MOTORES } from "../servicios/guion.js";
import { VozSchema } from "../servicios/voz.js";
import { creditosDe, type EscenaPreparada } from "../servicios/clips.js";
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
  duracion: z.number().int().min(15).max(180).default(65),
  evitar: z.array(z.string().max(160)).max(20).default([]),
});

const HistoriaSueltaSchema = PeticionGuionSchema.extend({
  voz: VozSchema,
  musica: z.string().max(120).nullable().default(null),
  modoPublicacion: z.enum(["DESCARGA", "BORRADOR_TIKTOK", "DIRECTO_TIKTOK"]).default("DESCARGA"),
  guion: GuionSchema.optional(),
  publicarEn: fechaFutura.nullable().default(null),
});

export async function rutasHistorias(app: FastifyInstance) {
  /** Vista previa del guion para el editor, sin gastar voz ni render. */
  app.post("/api/guion", async (req) => {
    const p = PeticionGuionSchema.parse(req.body);
    return generarGuion(p);
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
      motor: p.motor,
      modelo: p.modelo,
      voz: p.voz,
      musica: p.musica,
      modoPublicacion: p.modoPublicacion,
      guion: p.guion,
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
