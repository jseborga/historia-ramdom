import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { guardarIdeas } from "../servicios/banco.js";
import { guardarMetrica, resumenRendimiento } from "../servicios/metricas.js";
import { buscarIdeasAhora, sincronizarAhora } from "../cola/cola.js";
import { redditConfigurado } from "../servicios/reddit.js";
import { IdiomaCampo } from "../servicios/guion.js";
import { diagnosticar } from "../servicios/diagnostico.js";

const idParam = z.object({ id: z.string().uuid() });

const IdeaSchema = z.object({
  titulo: z.string().min(3).max(200),
  tema: z.string().min(3).max(200),
  idioma: IdiomaCampo.default("es"),
  notas: z.string().max(500).optional(),
});

const MetricaSchema = z.object({
  vistas: z.number().int().min(0),
  likes: z.number().int().min(0).default(0),
  comentarios: z.number().int().min(0).default(0),
  compartidos: z.number().int().min(0).default(0),
  guardados: z.number().int().min(0).default(0),
  duracionSeg: z.number().min(0).max(600).nullable().default(null),
  /** TikTok no lo da por API: se copia de TikTok Studio. */
  tiempoPromedioSeg: z.number().min(0).max(600).nullable().default(null),
});

export async function rutasBanco(app: FastifyInstance) {
  // ---- Banco de historias ----
  app.get("/api/ideas", async (req) => {
    const { estado, idioma } = z
      .object({
        estado: z.enum(["PENDIENTE", "USADA", "DESCARTADA"]).optional(),
        idioma: IdiomaCampo.optional(),
      })
      .parse(req.query);

    return db.idea.findMany({
      where: { ...(estado ? { estado } : {}), ...(idioma ? { idioma } : {}) },
      orderBy: [{ puntuacion: { sort: "desc", nulls: "last" } }, { creadaEn: "desc" }],
      take: 200,
    });
  });

  app.post("/api/ideas", async (req, reply) => {
    const ideas = z.array(IdeaSchema).min(1).max(100).parse(req.body);
    const nuevas = await guardarIdeas(ideas, "MANUAL");
    return reply.code(201).send({ nuevas });
  });

  app.patch("/api/ideas/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = z
      .object({
        estado: z.enum(["PENDIENTE", "USADA", "DESCARTADA"]).optional(),
        tema: z.string().min(3).max(200).optional(),
        notas: z.string().max(500).optional(),
      })
      .parse(req.body);
    return db.idea.update({ where: { id }, data: datos });
  });

  app.delete("/api/ideas/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await db.idea.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/ideas/buscar", async (req, reply) => {
    if (!redditConfigurado()) {
      return reply
        .code(400)
        .send({ error: "Reddit esta desactivado o le faltan credenciales" });
    }
    const job = await buscarIdeasAhora();
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });

  // ---- Ganchos ----
  app.get("/api/ganchos", async () =>
    db.gancho.findMany({
      orderBy: [{ puntuacion: { sort: "desc", nulls: "last" } }, { usos: "desc" }],
      take: 100,
    }),
  );

  app.delete("/api/ganchos/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await db.gancho.delete({ where: { id } });
    return { ok: true };
  });

  // ---- Rendimiento ----
  app.get("/api/rendimiento", async () => resumenRendimiento());

  app.get("/api/historias/:id/metrica", async (req) => {
    const { id } = idParam.parse(req.params);
    return db.metrica.findUnique({ where: { historiaId: id } });
  });

  /** Carga manual de metricas, incluido el tiempo de permanencia. */
  app.put("/api/historias/:id/metrica", async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = MetricaSchema.parse(req.body);
    const actual = await db.metrica.findUnique({ where: { historiaId: id } });
    return guardarMetrica(id, {
      ...datos,
      duracionSeg: datos.duracionSeg ?? actual?.duracionSeg ?? null,
      fuente: "MANUAL",
    });
  });

  /** Comprueba que cada clave y cada servicio responden de verdad. */
  app.get("/api/diagnostico", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async () =>
    diagnosticar(),
  );

  app.post("/api/metricas/sincronizar", async (_req, reply) => {
    const job = await sincronizarAhora();
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });
}
