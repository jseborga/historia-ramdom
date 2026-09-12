import type { ModoPublicacion } from "@prisma/client";
import { db } from "../db.js";
import { generarGuion, GuionSchema, contextoParaContinuar, criteriosVisuales, type Guion, type Premisa } from "../servicios/guion.js";
import { creditoMusica } from "../servicios/suno.js";
import { esLetra, type OpcionesVideoclip } from "../servicios/videoclip.js";
import { generarVoz } from "../servicios/voz.js";
import {
  elegirClips,
  elegirYDescargarClips,
  crearDescripcion,
  type EscenaPreparada,
} from "../servicios/clips.js";
import { pistasDesdeGuion } from "../servicios/proyecto.js";
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
  region?: string;
  modismos?: boolean;
  /** Continuación: historia anterior y número de parte. */
  continuaDeId?: string | null;
  /** Categoría ("aleatoria" = una al azar), subcategoría y planteamiento previo. */
  categoria?: string | null;
  subcategoria?: string | null;
  premisa?: Premisa | null;
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

/** Contexto de la parte anterior, si esta historia continúa otra. */
async function contextoDe(continuaDeId?: string | null) {
  if (!continuaDeId) return null;
  const anterior = await db.historia.findUnique({ where: { id: continuaDeId } });
  const guion = anterior ? GuionSchema.safeParse(anterior.guion) : null;
  return guion?.success ? contextoParaContinuar(guion.data, anterior!.parte) : null;
}

/** Ajustes de produccion que comparten una historia y sus continuaciones. */
type AjustesSerie = {
  tipo: string; duracion: number; idioma: string; region: string; modismos: boolean;
  categoria: string | null; subcategoria: string | null;
  motor: string; modelo: string | null; voz: unknown; modoAudio: "VOZ" | "MUSICA" | "MUDO";
  segundosEscena: number | null; musica: string | null; musicaModo: "FIJA" | "ROTAR";
  modoPublicacion: ModoPublicacion; salida: "VIDEO" | "MONTAJE"; partes: number;
};

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
        region: o.region,
        modismos: o.modismos,
        narrado: (o.modoAudio ?? "VOZ") === "VOZ",
        ganchoFijo: o.ganchoFijo,
        continuaDe: await contextoDe(o.continuaDeId),
        evitar: o.evitarTitulos ?? [],
        categoria: o.categoria,
        subcategoria: o.subcategoria,
        premisa: o.premisa,
      }));

    const gancho = await registrarGancho(guion.gancho, idioma);
    await db.historia.update({
      where: { id: historiaId },
      data: {
        guion,
        titulo: guion.titulo,
        categoria: guion.categoria ?? null,
        subcategoria: guion.subcategoria ?? null,
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
        descripcion: crearDescripcion(guion, escenas, creditoMusica(o.musica)),
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
  serie: AjustesSerie,
  o: { tema?: string; ganchoFijo?: string | null; ideaId?: string | null; continuaDeId?: string | null;
       musica?: string | null; evitarTitulos: (string | null)[]; clipsUsados: string[] },
) {
  try {
    const guion = await generarGuion({
      motor: serie.motor,
      modelo: serie.modelo,
      tipo: serie.tipo,
      tema: o.tema,
      duracion: serie.duracion,
      idioma: serie.idioma,
      region: serie.region,
      modismos: serie.modismos,
      narrado: serie.modoAudio === "VOZ",
      ganchoFijo: o.ganchoFijo,
      continuaDe: await contextoDe(o.continuaDeId),
      evitar: o.evitarTitulos,
      categoria: serie.categoria,
      subcategoria: serie.subcategoria,
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
    // Tres pistas de partida; despues, si hay voz, el ensamblador las rehace
    // con la narracion al mando: voz medida, textos donde suenan, clips largos.
    const pistas = pistasDesdeGuion(guion, clips, duraciones);
    const proyecto = await db.proyecto.create({
      data: {
        historiaId,
        nombre: guion.titulo,
        formato: "tiktok",
        escenas: pistas.video,
        textos: pistas.textos,
        voz: {
          modo: serie.modoAudio === "VOZ" ? "servidor" : "ninguna",
          texto: pistas.narracion,
          config: VOZ_POR_DEFECTO,
          archivo: null, duracion: null, inicio: 0, huella: null,
        },
        // La musica de la serie (fija o rotativa) entra en el montaje desde el principio.
        musica: { archivo: o.musica ?? null, subida: false, volumen: 0.25 },
      },
    });

    await db.historia.update({
      where: { id: historiaId },
      data: {
        guion,
        titulo: guion.titulo,
        categoria: guion.categoria ?? null,
        subcategoria: guion.subcategoria ?? null,
        ganchoTexto: guion.gancho,
        ganchoId: gancho.id,
        escenas,
        musica: o.musica ?? null,
        descripcion: crearDescripcion(guion, escenas, creditoMusica(o.musica)),
        estado: "MONTAJE",
      },
    });
    if (o.ideaId) await marcarIdeaUsada(o.ideaId);

    if (serie.modoAudio === "VOZ") {
      const { ensamblarProyecto } = await import("../servicios/ensamblar.js");
      await ensamblarProyecto(proyecto.id, { criterios: criteriosVisuales(guion) }).catch((err) =>
        db.historia.update({ where: { id: historiaId }, data: { error: `Ensamblado parcial: ${String(err).slice(0, 300)}` } }),
      );
    }
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

  const base: AjustesSerie = serie;
  await producirParte(h.id, base, {
    tema,
    ganchoFijo: ganchoProbado?.texto ?? null,
    ideaId: idea?.id ?? null,
    continuaDeId: null,
    musica,
    evitarTitulos: recientes.map((r) => r.titulo),
    clipsUsados: clipsDe(recientes),
  });

  // Historias por partes: las siguientes se encadenan una tras otra.
  let anterior = h.id;
  for (let parte = 2; parte <= (serie.partes ?? 1); parte++) {
    anterior = await continuarHistoria(anterior);
  }
  return h.id;
}

/** Produce una historia (o una parte) con los ajustes de su serie. */
async function producirParte(
  historiaId: string,
  base: AjustesSerie,
  o: { tema?: string; ganchoFijo: string | null; ideaId: string | null; continuaDeId: string | null;
       musica: string | null; evitarTitulos: (string | null)[]; clipsUsados: string[] },
) {
  if (base.salida === "MONTAJE") {
    return crearMontaje(historiaId, base, o);
  }
  return producir(historiaId, {
    tipo: base.tipo,
    tema: o.tema,
    duracion: base.duracion,
    idioma: base.idioma,
    region: base.region,
    modismos: base.modismos,
    categoria: base.categoria,
    subcategoria: base.subcategoria,
    continuaDeId: o.continuaDeId,
    motor: base.motor,
    modelo: base.modelo,
    voz: base.voz,
    modoAudio: base.modoAudio,
    segundosEscena: base.segundosEscena,
    musica: o.musica,
    modoPublicacion: base.modoPublicacion,
    ideaId: o.ideaId,
    ganchoFijo: o.ganchoFijo,
    evitarTitulos: o.evitarTitulos,
    clipsUsados: o.clipsUsados,
  });
}

/** Produce la parte siguiente de una historia, con los mismos ajustes. */
export async function continuarHistoria(historiaId: string): Promise<string> {
  const previa = await db.historia.findUniqueOrThrow({ where: { id: historiaId }, include: { serie: true } });
  const parte = previa.parte + 1;
  const h = await db.historia.create({
    data: { serieId: previa.serieId, ideaId: previa.ideaId, parte, continuaDeId: previa.id, estado: "GUION" },
  });
  const ajustes: AjustesSerie = previa.serie ?? {
    tipo: "Historia", duracion: 90, idioma: "es", region: "bolivia", modismos: true, motor: "groq", modelo: null,
    categoria: null, subcategoria: null,
    voz: VOZ_POR_DEFECTO, modoAudio: "VOZ", segundosEscena: null, musica: null, musicaModo: "FIJA",
    modoPublicacion: "DESCARGA", salida: "MONTAJE", partes: 1,
  };
  // La continuacion hereda la categoria concreta de la parte anterior: nunca
  // vuelve a sortear una ("aleatoria" es para historias nuevas).
  const base: AjustesSerie = {
    ...ajustes,
    categoria: previa.categoria ?? (ajustes.categoria === "aleatoria" ? null : ajustes.categoria),
    subcategoria: previa.subcategoria ?? ajustes.subcategoria,
  };
  const recientes = previa.serieId ? await recientesDeLaSerie(previa.serieId) : [];
  const musica = base.musicaModo === "ROTAR" ? await elegirMusicaRotativa(recientes.map((r) => r.musica)) : base.musica;

  await producirParte(h.id, base, {
    tema: undefined,
    ganchoFijo: null,
    ideaId: null,
    continuaDeId: previa.id,
    musica,
    evitarTitulos: recientes.map((r) => r.titulo),
    clipsUsados: clipsDe(recientes),
  });
  return h.id;
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
    // El nombre del MP4 es el id de quien lo produjo: historia, proyecto o corte.
    await db.historia.updateMany({ where: { id: { in: borrados } }, data: { archivo: null } });
    await db.proyecto.updateMany({ where: { id: { in: borrados } }, data: { archivo: null } });
    await db.variante.updateMany({ where: { id: { in: borrados } }, data: { archivo: null } });
  }
  await borrarSesionesCaducadas();
  return borrados.length;
}

/**
 * Deja el proyecto listo para renderizar: pistas validadas, narracion generada
 * si hacia falta, rutas reales de voz y musica, y el texto de creditos. Lo
 * comparten el render completo y el de cada corte, para que un corte suene y
 * se acredite exactamente igual que el montaje del que sale.
 */
async function prepararProyecto(proyectoId: string) {
  const { ProyectoSchema, desdeEscenasAntiguas, esModeloAntiguo, huellaVoz, creditosDeProyecto, descripcionDeProyecto } =
    await import("../servicios/proyecto.js");
  const { generarNarracion, narracionExiste } = await import("../servicios/narracion.js");
  const { rutaSubidaSegura } = await import("../almacen.js");
  const { creditoMusica } = await import("../servicios/suno.js");

  const p = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId }, include: { historia: true } });
  const escenas = Array.isArray(p.escenas) ? p.escenas : [];
  const pistas = esModeloAntiguo(escenas)
    ? desdeEscenasAntiguas(escenas)
    : { video: escenas, textos: Array.isArray(p.textos) ? p.textos : [] };
  const datos = ProyectoSchema.parse({
    nombre: p.nombre,
    formato: p.formato,
    video: pistas.video,
    textos: pistas.textos,
    voz: p.voz ?? {},
    musica: p.musica ?? {},
  });

  // La narracion del servidor se genera aqui si falta o si cambio el texto.
  if (datos.voz.modo === "servidor" && datos.voz.texto.trim()) {
    const vigente =
      datos.voz.archivo &&
      datos.voz.huella === huellaVoz(datos.voz) &&
      (await narracionExiste(proyectoId, datos.voz.archivo));
    if (!vigente) {
      const r = await generarNarracion(proyectoId, datos.voz);
      Object.assign(datos.voz, r);
      await db.proyecto.update({ where: { id: proyectoId }, data: { voz: datos.voz } });
    }
  }

  const rutaVoz =
    datos.voz.modo !== "ninguna" && datos.voz.archivo
      ? rutaSubidaSegura(proyectoId, datos.voz.archivo)
      : undefined;
  const rutaMusica = datos.musica.archivo
    ? datos.musica.subida
      ? rutaSubidaSegura(proyectoId, datos.musica.archivo)
      : rutaMusicaSegura(datos.musica.archivo)
    : undefined;

  // Descripcion para publicar: titulo, hashtags de la historia si la hay, y creditos.
  const guion = p.historia ? GuionSchema.safeParse(p.historia.guion) : null;
  const musicaCredito = creditoMusica(datos.musica.archivo);
  const letra = p.tipo === "MUSICA" ? esLetra(p.letra) : null;
  const hashtags = letra?.hashtags.length ? letra.hashtags : guion?.success ? guion.data.hashtags : [];
  const cabecera = letra?.titulo || (guion?.success ? guion.data.gancho : null);
  const descripcion = descripcionDeProyecto(p.nombre, datos.video, hashtags, cabecera, musicaCredito);

  return {
    p,
    datos,
    rutaVoz,
    rutaMusica,
    descripcion,
    creditos: creditosDeProyecto(datos.video, musicaCredito),
  };
}

/** Trabajo del editor: renderiza las tres pistas de un proyecto. */
export async function renderizarProyectoTrabajo(proyectoId: string) {
  const { renderizarProyecto } = await import("../render/proyecto.js");

  await db.proyecto.update({ where: { id: proyectoId }, data: { estado: "RENDER", error: null } });
  const dir = await crearCarpetaTrabajo(`proy-${proyectoId}`);

  try {
    const { p, datos, rutaVoz, rutaMusica, descripcion, creditos } = await prepararProyecto(proyectoId);
    const { archivo, duracion } = await renderizarProyecto(dir, {
      formato: datos.formato,
      video: datos.video,
      textos: datos.textos,
      voz: datos.voz,
      musica: datos.musica,
      rutaVoz,
      rutaMusica,
      titulo: p.nombre,
      creditos,
    });

    const final = await moverAVideos(archivo, proyectoId);
    await db.proyecto.update({
      where: { id: proyectoId },
      data: { archivo: final, duracionSeg: duracion, estado: "LISTO", descripcion },
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

/**
 * Monta un videoclip: la cancion decide la duracion, la letra (o los
 * lineamientos) decide que se ve en cada tramo.
 */
export async function montarVideoclipTrabajo(proyectoId: string, opciones: OpcionesVideoclip = {}) {
  const { montarVideoclip } = await import("../servicios/videoclip.js");
  try {
    const r = await montarVideoclip(proyectoId, opciones);
    await db.proyecto.update({
      where: { id: proyectoId },
      data: { estado: "BORRADOR", error: null, duracionSeg: r.duracion },
    });
    return proyectoId;
  } catch (err) {
    await db.proyecto.update({
      where: { id: proyectoId },
      data: { estado: "ERROR", error: String(err).slice(0, 800) },
    });
    throw err;
  }
}

/**
 * Renderiza un corte del montaje en su propio formato: el mismo material,
 * recortado a su ventana de tiempo y encajado en otro lienzo. No toca el
 * proyecto ni su MP4.
 */
export async function renderizarVarianteTrabajo(varianteId: string) {
  const { renderizarProyecto } = await import("../render/proyecto.js");
  const { recortarPistas, duracionProyecto } = await import("../servicios/proyecto.js");

  const v = await db.variante.findUniqueOrThrow({ where: { id: varianteId } });
  await db.variante.update({ where: { id: varianteId }, data: { estado: "RENDER", error: null } });
  const dir = await crearCarpetaTrabajo(`var-${varianteId}`);

  try {
    const { p, datos, rutaVoz, rutaMusica, creditos } = await prepararProyecto(v.proyectoId);
    const total = duracionProyecto(datos);
    const inicio = Math.min(Math.max(v.inicio, 0), Math.max(total - 0.5, 0));
    const pedida = v.duracion && v.duracion > 0 ? v.duracion : total - inicio;
    const largo = Math.max(0.5, Math.min(pedida, total - inicio));
    const corte = recortarPistas(datos, inicio, largo);

    const { archivo, duracion } = await renderizarProyecto(dir, {
      formato: v.formato,
      video: corte.video,
      textos: corte.textos,
      voz: corte.voz,
      musica: datos.musica,
      rutaVoz,
      rutaMusica,
      vozDesde: corte.vozDesde,
      musicaDesde: corte.musicaDesde,
      titulo: `${p.nombre} - ${v.nombre}`,
      creditos,
    });

    const final = await moverAVideos(archivo, varianteId);
    await db.variante.update({
      where: { id: varianteId },
      data: { archivo: final, duracionSeg: duracion, estado: "LISTO" },
    });
    return varianteId;
  } catch (err) {
    await db.variante.update({
      where: { id: varianteId },
      data: { estado: "ERROR", error: String(err).slice(0, 800) },
    });
    throw err;
  } finally {
    await borrarCarpetaTemporal(dir);
  }
}
