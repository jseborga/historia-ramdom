import type { ModoPublicacion } from "@prisma/client";
import { db } from "../db.js";
import { generarGuion, GuionSchema, type Guion } from "../servicios/guion.js";
import { generarVoz } from "../servicios/voz.js";
import {
  elegirYDescargarClips,
  crearDescripcion,
  type EscenaPreparada,
} from "../servicios/clips.js";
import {
  elegirIdea,
  marcarIdeaUsada,
  elegirGanchoProbado,
  registrarGancho,
} from "../servicios/banco.js";
import { renderizar } from "../render/render.js";
import {
  crearCarpetaTrabajo,
  borrarCarpetaTemporal,
  moverAVideos,
  rutaVideo,
  rutaMusicaSegura,
  elegirMusicaRotativa,
  limpiarDisco,
} from "../almacen.js";
import { borrarSesionesCaducadas } from "../seguridad/auth.js";
import { accessTokenVigente, subirABorradores, publicarDirecto } from "../servicios/tiktok.js";
import { sincronizarMetricas } from "../servicios/sincronizar.js";
import { buscarIdeasEnReddit } from "../servicios/reddit.js";
import { cola } from "./conexion.js";

export type OpcionesHistoria = {
  tipo: string;
  tema?: string;
  duracion: number;
  idioma?: string;
  motor: string;
  /** Modelo concreto del motor; vacio = el configurado en el entorno. */
  modelo?: string | null;
  voz: unknown;
  musica?: string | null;
  modoPublicacion: ModoPublicacion;
  /** Guion ya escrito (editor manual); si falta, lo genera el motor elegido. */
  guion?: Guion;
  /** Idea del banco que origina la historia. */
  ideaId?: string | null;
  /** Gancho probado que hay que repetir tal cual. */
  ganchoFijo?: string | null;
  /** Clip elegido a mano por escena (0 = el gancho): indice -> id de clip. */
  clipsElegidos?: Record<number, string>;
  /** Fecha ISO para programar la subida a TikTok; vacio = en cuanto termine. */
  publicarEn?: string | null;
  evitarTitulos?: (string | null)[];
  clipsUsados?: string[];
};

/** Milisegundos que faltan hasta la fecha pedida (0 si ya paso o no hay). */
export function retrasoHasta(fechaISO?: string | null) {
  if (!fechaISO) return 0;
  const ms = new Date(fechaISO).getTime() - Date.now();
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

/** Historias recientes de la serie: evitan repetir titulos, clips y musica. */
async function recientesDeLaSerie(serieId: string) {
  return db.historia.findMany({
    where: { serieId },
    orderBy: { creadaEn: "desc" },
    take: 20,
    select: { titulo: true, escenas: true, musica: true },
  });
}

function clipsDe(historias: { escenas: unknown }[]) {
  return historias.flatMap((r) =>
    ((r.escenas as EscenaPreparada[] | null) ?? [])
      .map((e) => e?.clip?.id)
      .filter((id): id is string => Boolean(id)),
  );
}

/**
 * Pipeline completo de una historia ya creada en la base de datos:
 * GUION -> CLIPS -> VOZ -> RENDER -> LISTA.
 */
async function producir(historiaId: string, o: OpcionesHistoria) {
  const dir = await crearCarpetaTrabajo(historiaId);
  const idioma = o.idioma ?? "es";

  try {
    // 1. Guion, con su gancho (reutilizado si venia uno probado)
    const guion =
      o.guion ??
      (await generarGuion({
        motor: o.motor,
        modelo: o.modelo,
        tipo: o.tipo,
        tema: o.tema,
        duracion: o.duracion,
        idioma,
        ganchoFijo: o.ganchoFijo,
        evitar: o.evitarTitulos ?? [],
      }));

    const gancho = await registrarGancho(guion.gancho, idioma);
    await db.historia.update({
      where: { id: historiaId },
      data: {
        guion,
        titulo: guion.titulo,
        ganchoTexto: guion.gancho,
        ganchoId: gancho.id,
        estado: "CLIPS",
      },
    });

    // 2. Clips. El gancho es su propia escena, la primera del video.
    const guionado = [
      { texto: guion.gancho, keywords: guion.escenas[0].keywords },
      ...guion.escenas,
    ];
    const escenas = await elegirYDescargarClips(
      guionado,
      dir,
      new Set(o.clipsUsados ?? []),
      o.clipsElegidos ?? {},
    );
    await db.historia.update({ where: { id: historiaId }, data: { escenas, estado: "VOZ" } });

    // 3. Voz escena por escena (respeta los limites por minuto del nivel gratuito)
    for (const [i, e] of escenas.entries()) {
      e.audio = await generarVoz(o.voz, e.texto, dir, i);
    }
    await db.historia.update({ where: { id: historiaId }, data: { escenas, estado: "RENDER" } });

    // 4. Render y descripcion con creditos
    const musica = o.musica ? rutaMusicaSegura(o.musica) : undefined;
    const { archivo, duracion } = await renderizar(
      dir,
      escenas.map((e, i) => ({
        texto: e.texto,
        archivo: e.archivo,
        audio: e.audio!,
        esGancho: i === 0,
      })),
      musica,
    );
    const final = await moverAVideos(archivo, historiaId);
    await db.historia.update({
      where: { id: historiaId },
      data: {
        archivo: final,
        musica: o.musica ?? null,
        descripcion: crearDescripcion(guion, escenas),
        estado: "LISTA",
      },
    });

    // La duracion real hace falta para calcular la retencion cuando lleguen
    // las metricas, asi que se guarda desde ya.
    await db.metrica.upsert({
      where: { historiaId },
      create: { historiaId, duracionSeg: duracion },
      update: { duracionSeg: duracion },
    });

    if (o.ideaId) await marcarIdeaUsada(o.ideaId);

    // 5. Publicacion segun el modo, inmediata o programada
    if (o.modoPublicacion !== "DESCARGA") {
      const delay = retrasoHasta(o.publicarEn);
      if (o.publicarEn) {
        await db.historia.update({
          where: { id: historiaId },
          data: { publicarEn: new Date(o.publicarEn) },
        });
      }
      await cola.add(
        "publicar",
        { historiaId },
        { delay, attempts: 3, backoff: { type: "exponential", delay: 120_000 } },
      );
    }

    return historiaId;
  } catch (err) {
    await db.historia.update({
      where: { id: historiaId },
      data: { estado: "ERROR", error: String(err).slice(0, 800) },
    });
    throw err; // BullMQ decide si reintenta
  } finally {
    await borrarCarpetaTemporal(dir);
  }
}

/** Trabajo del programador: una historia mas de una serie. */
export async function crearHistoria(serieId: string) {
  const serie = await db.serie.findUniqueOrThrow({ where: { id: serieId } });
  const recientes = await recientesDeLaSerie(serieId);

  // El banco manda: si hay idea pendiente se usa, si no se inventa un tema.
  const idea = await elegirIdea(serie.idioma);
  const ganchoProbado = await elegirGanchoProbado(serie.idioma);
  const musica =
    serie.musicaModo === "ROTAR"
      ? await elegirMusicaRotativa(recientes.map((r) => r.musica))
      : serie.musica;

  const h = await db.historia.create({
    data: { serieId, ideaId: idea?.id ?? null, estado: "GUION" },
  });

  const tema = idea
    ? idea.tema
    : serie.temas.length
      ? serie.temas[Math.floor(Math.random() * serie.temas.length)]
      : undefined;

  return producir(h.id, {
    tipo: serie.tipo,
    tema,
    duracion: serie.duracion,
    idioma: serie.idioma,
    motor: serie.motor,
    modelo: serie.modelo,
    voz: serie.voz,
    musica,
    modoPublicacion: serie.modoPublicacion,
    ideaId: idea?.id ?? null,
    ganchoFijo: ganchoProbado?.texto ?? null,
    evitarTitulos: recientes.map((r) => r.titulo),
    clipsUsados: clipsDe(recientes),
  });
}

/** Historia suelta creada desde el editor, sin serie asociada. */
export async function crearHistoriaSuelta(opciones: OpcionesHistoria) {
  const h = await db.historia.create({
    data: { estado: "GUION", ideaId: opciones.ideaId ?? null },
  });
  return producir(h.id, {
    ...opciones,
    guion: opciones.guion ? GuionSchema.parse(opciones.guion) : undefined,
  });
}

export async function publicarHistoria(historiaId: string) {
  const h = await db.historia.findUniqueOrThrow({
    where: { id: historiaId },
    include: { serie: true },
  });
  if (!h.archivo) throw new Error("La historia todavia no tiene video");

  const modo = h.serie?.modoPublicacion ?? "BORRADOR_TIKTOK";

  try {
    const token = await accessTokenVigente();
    const ruta = rutaVideo(h.id);
    const publishId =
      modo === "DIRECTO_TIKTOK"
        ? await publicarDirecto(token, ruta, h.descripcion ?? h.titulo ?? "")
        : await subirABorradores(token, ruta);

    await db.historia.update({
      where: { id: h.id },
      data: { publishId, estado: "SUBIDA", error: null },
    });
    return publishId;
  } catch (err) {
    await db.historia.update({
      where: { id: h.id },
      data: { estado: "ERROR", error: String(err).slice(0, 800) },
    });
    throw err;
  }
}

export { sincronizarMetricas, buscarIdeasEnReddit };

/** Limpieza diaria: disco, referencias en base de datos y sesiones caducadas. */
export async function limpiarArchivos() {
  const borrados = await limpiarDisco();
  if (borrados.length) {
    await db.historia.updateMany({ where: { id: { in: borrados } }, data: { archivo: null } });
  }
  await borrarSesionesCaducadas();
  return borrados.length;
}
