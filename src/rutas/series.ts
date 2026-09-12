import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { VozSchema } from "../servicios/voz.js";
import { MOTORES } from "../servicios/guion.js";
import { programarSerie, quitarSerie, generarAhora } from "../cola/cola.js";

/** Cinco campos separados por espacios: minuto hora dia mes dia-semana. */
const cron = z
  .string()
  .trim()
  .refine((v) => v.split(/\s+/).length === 5, "El horario debe tener 5 campos (ej. 0 9 * * *)");

const SerieSchema = z.object({
  nombre: z.string().min(1).max(80),
  tipo: z.enum(["Reflexion", "Historia"]),
  temas: z.array(z.string().min(1).max(120)).max(50).default([]),
  duracion: z.number().int().min(15).max(350).default(65),
  idioma: z.enum(["es", "en"]).default("es"),
  region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
  modismos: z.boolean().default(true),
  /** Historias por partes: cada ejecución produce N partes seguidas. */
  partes: z.number().int().min(1).max(6).default(1),
  cron,
  zonaHoraria: z.string().min(1).max(60).default("America/Lima"),
  motor: z.enum(MOTORES).default("groq"),
  modelo: z.string().max(80).nullable().default(null),
  voz: VozSchema,
  musica: z.string().max(120).nullable().default(null),
  musicaModo: z.enum(["FIJA", "ROTAR"]).default("FIJA"),
  modoAudio: z.enum(["VOZ", "MUSICA", "MUDO"]).default("VOZ"),
  segundosEscena: z.number().min(1).max(30).nullable().default(null),
  /** VIDEO renderiza solo; MONTAJE deja un proyecto en el editor para revisar. */
  salida: z.enum(["VIDEO", "MONTAJE"]).default("VIDEO"),
  modoPublicacion: z
    .enum(["DESCARGA", "BORRADOR_TIKTOK", "DIRECTO_TIKTOK"])
    .default("DESCARGA"),
  activa: z.boolean().default(true),
});

const idParam = z.object({ id: z.string().uuid() });

export async function rutasSeries(app: FastifyInstance) {
  app.get("/api/series", async () =>
    db.serie.findMany({
      orderBy: { creadaEn: "desc" },
      include: { _count: { select: { historias: true } } },
    }),
  );

  app.post("/api/series", async (req, reply) => {
    const datos = SerieSchema.parse(req.body);
    const serie = await db.serie.create({ data: datos });
    await programarSerie(serie);
    return reply.code(201).send(serie);
  });

  app.patch("/api/series/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const datos = SerieSchema.partial().parse(req.body);
    const serie = await db.serie.update({ where: { id }, data: datos });
    await programarSerie(serie);
    return serie;
  });

  app.delete("/api/series/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await quitarSerie(id);
    await db.serie.delete({ where: { id } });
    return { ok: true };
  });

  app.post("/api/series/:id/generar", async (req) => {
    const { id } = idParam.parse(req.params);
    await db.serie.findUniqueOrThrow({ where: { id } });
    const job = await generarAhora(id);
    return { encolada: true, jobId: job.id };
  });
}
