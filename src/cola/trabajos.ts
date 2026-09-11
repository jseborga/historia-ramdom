import type { ModoPublicacion } from "@prisma/client";
import { db } from "../db.js";
import { generarGuion, GuionSchema, type Guion } from "../servicios/guion.js";
import { generarVoz } from "../servicios/voz.js";
import {
  elegirYDescargarClips,
  crearDescripcion,
  type EscenaPreparada,
} from "../servicios/clips.js";
import { renderizar } from "../render/render.js";
import {
  crearCarpetaTrabajo,
  borrarCarpetaTemporal,
  moverAVideos,
  rutaVideo,
  rutaMusicaSegura,
  limpiarDisco,
} from "../almacen.js";
import { borrarSesionesCaducadas } from "../seguridad/auth.js";
import { accessTokenVigente, subirABorradores, publicarDirecto } from "../servicios/tiktok.js";
import { cola } from "./conexion.js";

export type OpcionesHistoria = {
  tipo: string;
  tema?: string;
  duracion: number;
  motor: string;
  voz: unknown;
  musica?: string | null;
  modoPublicacion: ModoPublicacion;
  /** Guion ya escrito (editor manual); si falta, lo genera el motor elegido. */
  guion?: Guion;
  evitarTitulos?: (string | null)[];
  clipsUsados?: Set<string>;
};

/** Historias recientes de la serie: sirven para no repetir titulos ni clips. */
async function recientesDeLaSerie(serieId: string) {
  return db.historia.findMany({
    where: { serieId },
    orderBy: { creadaEn: "desc" },
    take: 20,
    select: { titulo: true, escenas: true },
  });
}

function clipsDe(historias: { escenas: unknown }[]) {
  return new Set<string>(
    historias.flatMap((r) =>
      ((r.escenas as EscenaPreparada[] | null) ?? [])
        .map((e) => e?.clip?.id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
}

/**
 * Pipeline completo de una historia ya creada en la base de datos:
 * GUION -> CLIPS -> VOZ -> RENDER -> LISTA.
 */
async function producir(historiaId: string, o: OpcionesHistoria) {
  const dir = await crearCarpetaTrabajo(historiaId);

  try {
    // 1. Guion
    const guion =
      o.guion ??
      (await generarGuion({
        motor: o.motor,
        tipo: o.tipo,
        tema: o.tema,
        duracion: o.duracion,
        evitar: o.evitarTitulos ?? [],
      }));
    await db.historia.update({
      where: { id: historiaId },
      data: { guion, titulo: guion.titulo, estado: "CLIPS" },
    });

    // 2. Clips: no repetir los usados en las ultimas historias de la serie
    const escenas = await elegirYDescargarClips(guion.escenas, dir, o.clipsUsados ?? new Set());
    await db.historia.update({ where: { id: historiaId }, data: { escenas, estado: "VOZ" } });

    // 3. Voz escena por escena (respeta los limites por minuto del nivel gratuito)
    for (const [i, e] of escenas.entries()) {
      e.audio = await generarVoz(o.voz, e.texto, dir, i);
    }
    await db.historia.update({ where: { id: historiaId }, data: { escenas, estado: "RENDER" } });

    // 4. Render y descripcion con creditos
    const musica = o.musica ? rutaMusicaSegura(o.musica) : undefined;
    const { archivo } = await renderizar(
      dir,
      escenas.map((e) => ({ texto: e.texto, archivo: e.archivo, audio: e.audio! })),
      musica,
    );
    const final = await moverAVideos(archivo, historiaId);
    await db.historia.update({
      where: { id: historiaId },
      data: { archivo: final, descripcion: crearDescripcion(guion, escenas), estado: "LISTA" },
    });

    // 5. Publicacion segun el modo
    if (o.modoPublicacion !== "DESCARGA") {
      await cola.add(
        "publicar",
        { historiaId },
        { attempts: 3, backoff: { type: "exponential", delay: 120_000 } },
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
  const h = await db.historia.create({ data: { serieId, estado: "GUION" } });

  return producir(h.id, {
    tipo: serie.tipo,
    tema: serie.temas.length
      ? serie.temas[Math.floor(Math.random() * serie.temas.length)]
      : undefined,
    duracion: serie.duracion,
    motor: serie.motor,
    voz: serie.voz,
    musica: serie.musica,
    modoPublicacion: serie.modoPublicacion,
    evitarTitulos: recientes.map((r) => r.titulo),
    clipsUsados: clipsDe(recientes),
  });
}

/** Historia suelta creada desde el editor, sin serie asociada. */
export async function crearHistoriaSuelta(opciones: OpcionesHistoria) {
  const h = await db.historia.create({ data: { estado: "GUION" } });
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

/** Limpieza diaria: disco, referencias en base de datos y sesiones caducadas. */
export async function limpiarArchivos() {
  const borrados = await limpiarDisco();
  if (borrados.length) {
    await db.historia.updateMany({ where: { id: { in: borrados } }, data: { archivo: null } });
  }
  await borrarSesionesCaducadas();
  return borrados.length;
}
