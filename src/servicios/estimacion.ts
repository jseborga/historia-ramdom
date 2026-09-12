import { db } from "../db.js";
import { buscarPreset, type Preset } from "../render/presets.js";
import {
  CALIDADES,
  aplicarCalidad,
  estimar,
  perfilDe,
  type Calidad,
  type Estimacion,
} from "../render/calidad.js";
import { MAX_VIDEO_BYTES, env } from "../env.js";

/**
 * Cuanto va a pesar el video ANTES de renderizarlo.
 *
 * La primera vez se calcula con una tabla (bits por pixel de cada calidad);
 * a partir de ahi se usa lo que de verdad han pesado los renders anteriores
 * del mismo formato, que es mucho mas fiable porque depende del material:
 * un videoclip de planos quietos comprime la mitad que uno de acción.
 */

/** Cuantos renders pasados se miran para calibrar. */
const MUESTRAS = 8;

/** Bits por pixel y fotograma medidos en renders anteriores de ese formato. */
export async function bppHistorico(formato: string, calidad: Calidad): Promise<number | null> {
  const preset = buscarPreset(formato);
  const lienzo = aplicarCalidad(preset, calidad);
  const pixeles = lienzo.ancho * lienzo.alto * lienzo.fps;
  if (pixeles <= 0) return null;

  const [proyectos, variantes] = await Promise.all([
    db.proyecto.findMany({
      where: { formato, calidad, bytes: { gt: 0 }, duracionSeg: { gt: 1 } },
      select: { bytes: true, duracionSeg: true },
      orderBy: { editadoEn: "desc" },
      take: MUESTRAS,
    }),
    db.variante.findMany({
      where: { formato, calidad, bytes: { gt: 0 }, duracionSeg: { gt: 1 } },
      select: { bytes: true, duracionSeg: true },
      orderBy: { creadaEn: "desc" },
      take: MUESTRAS,
    }),
  ]);

  const muestras = [...proyectos, ...variantes]
    .map((x) => ((x.bytes ?? 0) * 8) / (x.duracionSeg ?? 1) / pixeles)
    // Fuera lo imposible: un render fallido o un archivo a medias.
    .filter((b) => b > 0.005 && b < 0.5);
  if (!muestras.length) return null;
  return muestras.reduce((a, b) => a + b, 0) / muestras.length;
}

export type ResumenEstimacion = {
  duracion: number;
  formato: string;
  limiteMB: number;
  /** La calidad elegida ahora mismo. */
  calidad: Calidad;
  opciones: (Estimacion & { cabe: boolean; medido: boolean })[];
  /** Aviso en texto llano cuando el archivo no cabe con la calidad actual. */
  aviso: string | null;
};

/** Las tres calidades con su peso estimado, y si caben en el límite. */
export async function estimarSalida(
  duracion: number,
  formato: string,
  calidad: Calidad = "normal",
): Promise<ResumenEstimacion> {
  const preset: Preset = buscarPreset(formato);
  const opciones = [];
  for (const c of CALIDADES) {
    const bpp = await bppHistorico(formato, c);
    const e = estimar(duracion, preset, c, bpp);
    opciones.push({ ...e, cabe: e.bytes <= MAX_VIDEO_BYTES, medido: bpp !== null });
  }

  const elegida = opciones.find((o) => o.calidad === calidad) ?? opciones[1];
  const alternativa = opciones.find((o) => o.cabe && o.bytes < elegida.bytes);
  const aviso = elegida.cabe
    ? null
    : `Con calidad ${perfilDe(calidad).nombre.toLowerCase()} el vídeo rondaría ${elegida.mb} MB y el tope es ` +
      `${env.MAX_VIDEO_MB} MB. ${
        alternativa
          ? `Con la calidad ${alternativa.nombre.toLowerCase()} bajaría a unos ${alternativa.mb} MB.`
          : "Acorta el vídeo o sube MAX_VIDEO_MB."
      }`;

  return { duracion, formato, limiteMB: env.MAX_VIDEO_MB, calidad, opciones, aviso };
}
