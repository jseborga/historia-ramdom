import { db } from "../db.js";

/**
 * Puntuacion de 0 a 100 de una historia publicada.
 *
 * TikTok solo entrega vistas, likes, comentarios, compartidos y guardados por
 * API; el tiempo de permanencia hay que copiarlo a mano desde TikTok Studio.
 * Por eso la formula usa la retencion cuando esta disponible y reparte su peso
 * en la interaccion cuando no lo esta.
 */
export const PESO_RETENCION = 0.6;
export const PESO_INTERACCION = 0.4;

/** Interaccion que ya se considera excelente (12 % de las vistas). */
export const INTERACCION_TOPE = 0.12;

/** Por debajo de estas vistas la muestra es demasiado pequena para fiarse. */
export const VISTAS_MINIMAS = 200;

export type DatosMetrica = {
  vistas: number;
  likes: number;
  comentarios: number;
  compartidos: number;
  guardados: number;
  duracionSeg?: number | null;
  tiempoPromedioSeg?: number | null;
};

export function calcularPuntuacion(m: DatosMetrica): number | null {
  if (m.vistas < VISTAS_MINIMAS) return null;

  // Compartir y guardar pesan doble: son las senales que mas empujan el alcance.
  const interaccion =
    (m.likes + m.comentarios + 2 * m.compartidos + 2 * m.guardados) / m.vistas;
  const normalizada = Math.min(interaccion / INTERACCION_TOPE, 1);

  const hayRetencion = Boolean(m.duracionSeg && m.tiempoPromedioSeg);
  if (!hayRetencion) return Math.round(normalizada * 100 * 10) / 10;

  const retencion = Math.min(m.tiempoPromedioSeg! / m.duracionSeg!, 1);
  const total = PESO_RETENCION * retencion + PESO_INTERACCION * normalizada;
  return Math.round(total * 100 * 10) / 10;
}

/** Media de las puntuaciones ya calculadas, ignorando las que no tienen. */
function media(valores: (number | null)[]) {
  const utiles = valores.filter((v): v is number => v !== null);
  if (!utiles.length) return null;
  return Math.round((utiles.reduce((a, b) => a + b, 0) / utiles.length) * 10) / 10;
}

/**
 * Guarda la metrica, recalcula su puntuacion y propaga la media a la idea y al
 * gancho que produjeron la historia, que es lo que luego decide que se reusa.
 */
export async function guardarMetrica(
  historiaId: string,
  datos: DatosMetrica & { fuente?: "API" | "MANUAL" },
) {
  const historia = await db.historia.findUniqueOrThrow({
    where: { id: historiaId },
    select: { id: true, ideaId: true, ganchoId: true },
  });

  const puntuacion = calcularPuntuacion(datos);
  const fila = {
    vistas: datos.vistas,
    likes: datos.likes,
    comentarios: datos.comentarios,
    compartidos: datos.compartidos,
    guardados: datos.guardados,
    duracionSeg: datos.duracionSeg ?? null,
    tiempoPromedioSeg: datos.tiempoPromedioSeg ?? null,
    puntuacion,
    fuente: datos.fuente ?? "MANUAL",
  } as const;

  const metrica = await db.metrica.upsert({
    where: { historiaId },
    create: { historiaId, ...fila },
    update: fila,
  });

  await recalcularOrigen(historia.ideaId, historia.ganchoId);
  return metrica;
}

/** Vuelve a promediar la puntuacion de la idea y del gancho indicados. */
export async function recalcularOrigen(ideaId?: string | null, ganchoId?: string | null) {
  if (ideaId) {
    const historias = await db.historia.findMany({
      where: { ideaId },
      select: { metrica: { select: { puntuacion: true } } },
    });
    await db.idea.update({
      where: { id: ideaId },
      data: { puntuacion: media(historias.map((h) => h.metrica?.puntuacion ?? null)) },
    });
  }

  if (ganchoId) {
    const historias = await db.historia.findMany({
      where: { ganchoId },
      select: { metrica: { select: { puntuacion: true } } },
    });
    await db.gancho.update({
      where: { id: ganchoId },
      data: { puntuacion: media(historias.map((h) => h.metrica?.puntuacion ?? null)) },
    });
  }
}

/** Resumen para la pantalla de rendimiento. */
export async function resumenRendimiento(limite = 20) {
  const [mejoresGanchos, mejoresIdeas, historias] = await Promise.all([
    db.gancho.findMany({
      where: { puntuacion: { not: null } },
      orderBy: { puntuacion: "desc" },
      take: limite,
    }),
    db.idea.findMany({
      where: { puntuacion: { not: null } },
      orderBy: { puntuacion: "desc" },
      take: limite,
    }),
    db.metrica.findMany({
      orderBy: { actualizadaEn: "desc" },
      take: limite,
      include: { historia: { select: { id: true, titulo: true, ganchoTexto: true } } },
    }),
  ]);
  return { mejoresGanchos, mejoresIdeas, historias };
}
