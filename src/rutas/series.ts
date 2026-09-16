import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { VozSchema } from "../servicios/voz.js";
import { IdiomaCampo, MOTORES } from "../servicios/guion.js";
import { esCategoriaValida } from "../servicios/categorias.js";
import { esBanco, esMedio } from "../servicios/clips.js";
import { programarSerie, quitarSerie, generarAhora } from "../cola/cola.js";
import { MAX_LARGO_SEG } from "../render/presets.js";

/** Cinco campos separados por espacios: minuto hora dia mes dia-semana. */
const cron = z
  .string()
  .trim()
  .refine((v) => v.split(/\s+/).length === 5, "El horario debe tener 5 campos (ej. 0 9 * * *)");

const SerieSchema = z.object({
  nombre: z.string().min(1).max(80),
  tipo: z.enum(["Reflexion", "Historia"]),
  temas: z.array(z.string().min(1).max(120)).max(50).default([]),
  duracion: z.number().int().min(15).max(MAX_LARGO_SEG).default(65),
  idioma: IdiomaCampo.default("es"),
  region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
  modismos: z.boolean().default(true),
  /** Historias por partes: cada ejecución produce N partes seguidas. */
  partes: z.number().int().min(1).max(6).default(1),
  /** Dónde buscar imagen: pexels, pixabay, nasa. Vacío = lo que use la categoría. */
  bancos: z.array(z.string().max(20).refine(esBanco, "Banco desconocido")).max(3).default([]),
  /** Medios admitidos: video, imagen. Vacío = lo que use la categoría. */
  medios: z.array(z.string().max(20).refine(esMedio, "Medio desconocido")).max(2).default([]),
  /** Categoría fija, "aleatoria" (una distinta cada vez) o vacía (tema libre). */
  categoria: z.string().max(40).nullable().default(null).refine((v) => !v || esCategoriaValida(v), "Categoría desconocida"),
  /** Subcategoría fija; vacía = al azar dentro de la categoría. */
  subcategoria: z.string().max(40).nullable().default(null),
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
