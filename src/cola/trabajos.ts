import type { ModoPublicacion } from "@prisma/client";
import { db } from "../db.js";
import { generarGuion, GuionSchema, type Guion } from "../servicios/guion.js";
import { generarVoz } from "../servicios/voz.js";
import {
  elegirClips,
  elegirYDescargarClips,
  crearDescripcion,
  type EscenaPreparada,
} from "../servicios/clips.js";
import { lineaDeTiempoDesdeGuion } from "../servicios/proyecto.js";
import { VOZ_POR_DEFECTO } from "../servicios/voz.js";
import {
  elegirIdea,
  marcarIdeaUsada,
  elegirGanchoProbado,
  registrarGancho,
} from "../servicios/banco.js";
import { renderizar, duracionPorTexto, type ModoAudio } from "../render/render.js";
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
  /** VOZ narra; MUSICA y MUDO prescinden de la voz y no gastan cuota de TTS. */
  modoAudio?: ModoAudio;
  /** Segundos por escena cuando no hay voz; vacio = se calcula por el texto. */
  segundosEscena?: number | null;
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
        narrado: (o.modoAudio ?? "VOZ") === "VOZ",
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
    await db.historia.update({ where: { id: historiaId }, data: { escenas } });

    // 3. Voz escena por escena, solo si la historia lleva narracion.
    //    En MUSICA y MUDO este paso se salta entero: no se gasta cuota de TTS.
    const modoAudio = o.modoAudio ?? "VOZ";
    if (modoAudio === "VOZ") {
      await db.historia.update({ where: { id: historiaId }, data: { estado: "VOZ" } });
      for (const [i, e] of escenas.entries()) {
        e.audio = await generarVoz(o.voz, e.texto, dir, i);
      }
    }
    await db.historia.update({ where: { id: historiaId }, data: { escenas, estado: "RENDER" } });

    // 4. Render y descripcion con creditos
    const musica = o.musica ? rutaMusicaSegura(o.musica) : undefined;
    const { archivo, duracion } = await renderizar(
      dir,
      escenas.map((e, i) => ({
        texto: e.texto,
        archivo: e.archivo!,
        audio: e.audio,
        // Sin voz, la duracion la marca el texto, no el audio.
        duracion:
          modoAudio === "VOZ" ? undefined : duracionPorTexto(e.texto, o.segundosEscena),
        esGancho: i === 0,
      })),
      { modoAudio, musica },
    );
    const final = await moverAVideos(archivo, historiaId);
    await db.historia.update({
      where: { id: historiaId },
      data: {
        archivo: final,
        musica: o.musica ?? null,
        modoAudio,
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

/**
 * Salida MONTAJE: escribe el guion, elige los clips (solo enlaces, sin bajar
 * nada) y deja un proyecto abierto en el editor. Nada de voz ni de render:
 * eso se decide mirando el montaje.
 */
async function crearMontaje(
  historiaId: string,
  serie: { nombre: string; tipo: string; duracion: number; idioma: string; motor: string;
           modelo: string | null; segundosEscena: number | null; modoAudio: string },
  o: { tema?: string; ganchoFijo?: string | null; ideaId?: string | null;
       evitarTitulos: (string | null)[]; clipsUsados: string[] },
) {
  try {
    const guion = await generarGuion({
      motor: serie.motor,
      modelo: serie.modelo,
      tipo: serie.tipo,
      tema: o.tema,
      duracion: serie.duracion,
      idioma: serie.idioma,
      narrado: serie.modoAudio === "VOZ",
      ganchoFijo: o.ganchoFijo,
      evitar: o.evitarTitulos,
    });
    const gancho = await registrarGancho(guion.gancho, serie.idioma);

    const guionado = [
      { texto: guion.gancho, keywords: guion.escenas[0].keywords },
      ...guion.escenas,
    ];
    const clips = await elegirClips(guionado, new Set(o.clipsUsados));
    const escenas: EscenaPreparada[] = guionado
      .map((e, i) => ({ texto: e.texto, keywords: e.keywords, clip: clips[i]! }))
      .filter((e) => e.clip);

    // Las duraciones iniciales salen del texto; el editor las cambia a gusto.
    const duraciones = guionado.map((e) => duracionPorTexto(e.texto, serie.segundosEscena));
    const proyecto = await db.proyecto.create({
      data: {
        historiaId,
        nombre: guion.titulo,
        formato: "tiktok",
        escenas: lineaDeTiempoDesdeGuion(guion, clips, duraciones),
        voz: serie.modoAudio === "VOZ"
          ? { modo: "ia", archivo: null, config: VOZ_POR_DEFECTO }
          : { modo: "ninguna", archivo: null, config: null },
        musica: { archivo: null, subida: false, volumen: 0.25 },
      },
    });

    await db.historia.update({
      where: { id: historiaId },
      data: {
        guion,
        titulo: guion.titulo,
        ganchoTexto: guion.gancho,
        ganchoId: gancho.id,
        escenas,
        descripcion: crearDescripcion(guion, escenas),
        estado: "MONTAJE",
      },
    });
    if (o.ideaId) await marcarIdeaUsada(o.ideaId);
    return proyecto.id;
  } catch (err) {
    await db.historia.update({
      where: { id: historiaId },
      data: { estado: "ERROR", error: String(err).slice(0, 800) },
    });
    throw err;
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

  if (serie.salida === "MONTAJE") {
    return crearMontaje(h.id, serie, {
      tema,
      ganchoFijo: ganchoProbado?.texto ?? null,
      ideaId: idea?.id ?? null,
      evitarTitulos: recientes.map((r) => r.titulo),
      clipsUsados: clipsDe(recientes),
    });
  }

  return producir(h.id, {
    tipo: serie.tipo,
    tema,
    duracion: serie.duracion,
    idioma: serie.idioma,
    motor: serie.motor,
    modelo: serie.modelo,
    voz: serie.voz,
    modoAudio: serie.modoAudio,
    segundosEscena: serie.segundosEscena,
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

/** Trabajo del editor: renderiza la linea de tiempo de un proyecto. */
export async function renderizarProyectoTrabajo(proyectoId: string) {
  const { renderizarProyecto } = await import("../render/proyecto.js");
  const { ProyectoSchema } = await import("../servicios/proyecto.js");
  const { rutaSubidaSegura } = await import("../almacen.js");

  const p = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const datos = ProyectoSchema.parse({
    nombre: p.nombre,
    formato: p.formato,
    escenas: p.escenas,
    voz: p.voz ?? {},
    musica: p.musica ?? {},
  });

  await db.proyecto.update({
    where: { id: proyectoId },
    data: { estado: "RENDER", error: null },
  });
  const dir = await crearCarpetaTrabajo(`proy-${proyectoId}`);

  try {
    const rutaVoz =
      datos.voz.modo === "archivo" && datos.voz.archivo
        ? rutaSubidaSegura(proyectoId, datos.voz.archivo)
        : undefined;
    const rutaMusica = datos.musica.archivo
      ? datos.musica.subida
        ? rutaSubidaSegura(proyectoId, datos.musica.archivo)
        : rutaMusicaSegura(datos.musica.archivo)
      : undefined;

    const { archivo, duracion } = await renderizarProyecto(dir, {
      escenas: datos.escenas,
      formato: datos.formato,
      voz: datos.voz,
      musica: datos.musica,
      rutaVoz,
      rutaMusica,
    });

    const final = await moverAVideos(archivo, proyectoId);
    await db.proyecto.update({
      where: { id: proyectoId },
      data: { archivo: final, duracionSeg: duracion, estado: "LISTO" },
    });
    return proyectoId;
  } catch (err) {
    await db.proyecto.update({
      where: { id: proyectoId },
      data: { estado: "ERROR", error: String(err).slice(0, 800) },
    });
    throw err;
  } finally {
    await borrarCarpetaTemporal(dir);
  }
}
