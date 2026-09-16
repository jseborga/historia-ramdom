import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { rutaVideo } from "../almacen.js";
import {
  generarGuion,
  generarPremisa,
  generarMiniserie,
  contextoDeCapitulo,
  GuionSchema,
  PremisaSchema,
  MiniserieSchema,
  MOTORES,
  type ContextoCapitulo,
} from "../servicios/guion.js";
import { esCategoriaValida, buscarCategoria } from "../servicios/categorias.js";
import { creditoMusica } from "../servicios/suno.js";
import { VozSchema } from "../servicios/voz.js";
import {
  buscarClips,
  buscarConEstado,
  creditosDe,
  esBanco,
  esMedio,
  bancosDisponibles,
  type Banco,
  type ClipInfo,
  type EscenaPreparada,
  type TipoMedio,
} from "../servicios/clips.js";
import {
  guionATexto,
  textoAGuion,
  INSTRUCCIONES_IA,
} from "../servicios/guionTexto.js";
import { cola, encolarHistoriaSuelta, encolarContinuacion } from "../cola/cola.js";
import { MAX_LARGO_SEG } from "../render/presets.js";
import { retrasoHasta } from "../cola/trabajos.js";

const idParam = z.object({ id: z.string().uuid() });

/** Fecha ISO futura para programar una subida. */
const fechaFutura = z
  .string()
  .datetime({ offset: true })
  .refine((v) => new Date(v).getTime() > Date.now() - 60_000, "La fecha ya paso");

/** Id de categoría, "aleatoria" o vacío (tema libre, como siempre). */
export const CategoriaCampo = z
  .string()
  .max(40)
  .nullable()
  .default(null)
  .refine((v) => !v || esCategoriaValida(v), "Categoría desconocida");

export const SubcategoriaCampo = z.string().max(40).nullable().default(null);

/** Bancos de imagen elegidos a mano; vacío = los que use la categoría. */
export const BancosCampo = z
  .array(z.string().max(20).refine(esBanco, "Banco desconocido"))
  .max(3)
  .default([]);

/** Vídeo, foto o las dos; vacío = lo que use la categoría. */
export const MediosCampo = z
  .array(z.string().max(20).refine(esMedio, "Medio desconocido"))
  .max(2)
  .default([]);

const PeticionGuionSchema = z.object({
  motor: z.enum(MOTORES).default("groq"),
  modelo: z.string().max(80).nullable().default(null),
  tipo: z.enum(["Reflexion", "Historia"]),
  tema: z.string().max(200).optional(),
  categoria: CategoriaCampo,
  subcategoria: SubcategoriaCampo,
  /** Planteamiento ya generado y revisado; si falta y hay categoría, se genera al vuelo. */
  premisa: PremisaSchema.nullable().default(null),
  /** Miniserie ya planeada y el capítulo que toca escribir de ella. */
  miniserie: MiniserieSchema.nullable().default(null),
  capitulo: z.number().int().min(1).max(12).nullable().default(null),
  idioma: z.enum(["es", "en"]).default("es"),
  region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
  modismos: z.boolean().default(true),
  duracion: z.number().int().min(15).max(MAX_LARGO_SEG).default(65),
  evitar: z.array(z.string().max(160)).max(20).default([]),
});

/** Clip elegido a mano: { "0": "pexels-123" }. La clave es el indice de escena. */
const ClipsElegidosSchema = z
  .record(z.string().regex(/^\d+$/), z.string().max(200))
  .default({})
  .transform((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [Number(k), v])));

const HistoriaSueltaSchema = PeticionGuionSchema.extend({
  voz: VozSchema,
  bancos: BancosCampo,
  medios: MediosCampo,
  modoAudio: z.enum(["VOZ", "MUSICA", "MUDO"]).default("VOZ"),
  segundosEscena: z.number().min(1).max(30).nullable().default(null),
  musica: z.string().max(120).nullable().default(null),
  modoPublicacion: z.enum(["DESCARGA", "BORRADOR_TIKTOK", "DIRECTO_TIKTOK"]).default("DESCARGA"),
  guion: GuionSchema.optional(),
  ideaId: z.string().uuid().nullable().default(null),
  clipsElegidos: ClipsElegidosSchema,
  publicarEn: fechaFutura.nullable().default(null),
});

/** Convierte `miniserie` + `capitulo` en el contexto que entiende el guion. */
function conCapitulo<T extends { miniserie?: unknown; capitulo?: number | null }>(
  p: T,
): Omit<T, "miniserie" | "capitulo"> & { capitulo: ContextoCapitulo | null } {
  const { miniserie, capitulo, ...resto } = p;
  const plan = miniserie ? MiniserieSchema.parse(miniserie) : null;
  return { ...resto, capitulo: plan ? contextoDeCapitulo(plan, capitulo ?? 1) : null };
}

export async function rutasHistorias(app: FastifyInstance) {
  /** Vista previa del guion para el editor, sin gastar voz ni render. */
  app.post("/api/guion", async (req) => {
    const p = PeticionGuionSchema.parse(req.body);
    return generarGuion(conCapitulo(p));
  });

  /**
   * Planea una miniserie entera: título, sinopsis, personajes y qué pasa en
   * cada capítulo, con su corte final. Después cada capítulo se escribe por
   * separado pasando `miniserie` y `capitulo` a /api/guion o /api/historias.
   */
  app.post("/api/miniserie", async (req) => {
    const p = PeticionGuionSchema.omit({ premisa: true, miniserie: true, capitulo: true, tipo: true })
      .extend({ tipo: z.string().max(40).optional(), capitulos: z.number().int().min(2).max(12).default(4) })
      .parse(req.body);
    const plan = await generarMiniserie({ ...p, categoria: p.categoria ?? "aleatoria" });
    const cat = buscarCategoria(plan.categoria);
    return {
      ...plan,
      categoriaNombre: cat?.nombre ?? plan.categoria,
      subcategoriaNombre: cat?.subcategorias.find((s) => s.id === plan.subcategoria)?.nombre ?? plan.subcategoria,
    };
  });

  /**
   * Planteamiento previo: elige categoría y subcategoría (al azar si no se
   * fijan) y genera título, lineamientos, giro y criterios de búsqueda de
   * clips, sin escribir la historia. Se revisa y luego se pasa a /api/guion.
   */
  app.post("/api/premisa", async (req) => {
    const p = PeticionGuionSchema.omit({ premisa: true, tipo: true }).extend({ tipo: z.string().max(40).optional() }).parse(req.body);
    const premisa = await generarPremisa({ ...p, categoria: p.categoria ?? "aleatoria" });
    const cat = buscarCategoria(premisa.categoria);
    return {
      ...premisa,
      categoriaNombre: cat?.nombre ?? premisa.categoria,
      subcategoriaNombre: cat?.subcategorias.find((s) => s.id === premisa.subcategoria)?.nombre ?? premisa.subcategoria,
    };
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

  /**
   * Continúa una historia en una parte nueva: el guion se escribe retomando
   * justo donde quedó, con los mismos ajustes, y se produce igual que ella.
   */
  app.post("/api/historias/:id/continuar", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await db.historia.findUniqueOrThrow({ where: { id } });
    const job = await encolarContinuacion(id);
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });

  app.get("/api/historias", async (req) => {
    const { serieId, limite } = z
      .object({
        serieId: z.string().uuid().optional(),
        limite: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);

    const historias = await db.historia.findMany({
      where: serieId ? { serieId } : {},
      orderBy: { creadaEn: "desc" },
      take: limite,
      select: {
        id: true,
        serieId: true,
        estado: true,
        titulo: true,
        categoria: true,
        subcategoria: true,
        idioma: true,
        parte: true,
        continuaDeId: true,
        ganchoTexto: true,
        metrica: { select: { vistas: true, likes: true, puntuacion: true, tiempoPromedioSeg: true } },
        descripcion: true,
        archivo: true,
        publishId: true,
        publicarEn: true,
        error: true,
        creadaEn: true,
        guion: true,
      },
    });

    // Del guion solo viajan los ganchos de la descripción: son los que se
    // prueban uno a uno para ver cuál rinde, y el guion entero pesa demasiado
    // para una lista.
    return historias.map(({ guion, ...h }) => {
      const datos = GuionSchema.safeParse(guion);
      return { ...h, ganchos: datos.success ? datos.data.ganchos : [] };
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
    const h = await db.historia.findUnique({ where: { id }, select: { escenas: true, musica: true } });
    if (!h) return reply.code(404).send({ error: "No encontrada" });
    const escenas = (h.escenas as EscenaPreparada[] | null) ?? [];
    return { creditos: [creditosDe(escenas), creditoMusica(h.musica) ?? ""].filter(Boolean).join("\n") };
  });

  /** Encola una historia suelta (editor manual, sin serie). */
  app.post("/api/historias", async (req, reply) => {
    const p = conCapitulo(HistoriaSueltaSchema.parse(req.body));
    const job = await encolarHistoriaSuelta({
      tipo: p.tipo,
      tema: p.tema,
      duracion: p.duracion,
      idioma: p.idioma,
      region: p.region,
      modismos: p.modismos,
      categoria: p.categoria,
      subcategoria: p.subcategoria,
      premisa: p.premisa,
      capitulo: p.capitulo,
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
      bancos: p.bancos,
      medios: p.medios,
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
    const { keywords, bancos, medios } = z
      .object({
        keywords: z.string().min(1).max(200),
        /** Separados por coma: "pexels,nasa". Vacío = todos los disponibles. */
        bancos: z.string().max(60).optional(),
        /** "video", "imagen" o las dos. Vacío = solo vídeo. */
        medios: z.string().max(40).optional(),
      })
      .parse(req.query);

    const lista = keywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .slice(0, 3);

    const opciones = {
      bancos: (bancos ?? "").split(",").map((b) => b.trim()).filter(esBanco) as Banco[],
      medios: (medios ?? "").split(",").map((m) => m.trim()).filter(esMedio) as TipoMedio[],
    };
    const resultados = await Promise.all(lista.map((k) => buscarConEstado(k, opciones)));
    // Sin repetir: la misma keyword en dos escenas puede traer los mismos.
    const unicos = new Map<string, ClipInfo>();
    for (const clip of resultados.flatMap((r) => r.clips)) unicos.set(clip.id, clip);

    // Qué hizo cada banco, sumando las keywords: un banco vacío o roto tiene
    // que verse en la pantalla, no quedarse en un catch.
    const porBanco = new Map<string, { banco: string; encontrados: number; error?: string }>();
    for (const estado of resultados.flatMap((r) => r.bancos)) {
      const previo = porBanco.get(estado.banco) ?? { banco: estado.banco, encontrados: 0 };
      porBanco.set(estado.banco, {
        banco: estado.banco,
        encontrados: previo.encontrados + estado.encontrados,
        error: previo.error ?? estado.error,
      });
    }

    return { clips: [...unicos.values()].slice(0, 24), bancos: [...porBanco.values()] };
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
