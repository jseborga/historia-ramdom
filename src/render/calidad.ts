import type { Preset } from "./presets.js";

/**
 * Cuanto pesa el video que sale, y como bajarlo.
 *
 * El tamaño de un MP4 es, con muy poca variacion, bitrate x duracion. El
 * bitrate depende de tres cosas: el tamaño del lienzo, los fotogramas por
 * segundo y cuanto comprime el codificador (CRF: cuanto mas alto, mas
 * comprime y menos pesa). Con eso se puede decir de antemano, con un margen
 * razonable, cuanto va a ocupar un montaje ANTES de renderizarlo.
 */

export type Calidad = "alta" | "normal" | "ligera";

export const CALIDADES = ["alta", "normal", "ligera"] as const;

export type PerfilCalidad = {
  id: Calidad;
  nombre: string;
  /** Factor de compresion de x264; mas alto = menos peso y menos detalle. */
  crf: number;
  /** Cuanto se esfuerza el codificador; "slow" pesa menos pero tarda mas. */
  preset: string;
  audioKbps: number;
  /** Escala del lienzo: 1 = el del formato, 0.667 = 720p desde 1080p. */
  escala: number;
  /** Fotogramas por segundo; vacio = los del formato. */
  fps: number | null;
  /**
   * Bits por pixel y fotograma con material de archivo normal. Es lo que
   * convierte "1080x1920 a 30 fps" en megabytes, y se recalibra con lo que
   * de verdad han pesado los renders anteriores.
   */
  bpp: number;
  nota: string;
};

export const PERFILES: Record<Calidad, PerfilCalidad> = {
  alta: {
    id: "alta",
    nombre: "Alta (archivo grande)",
    crf: 20,
    preset: "medium",
    audioKbps: 192,
    escala: 1,
    fps: null,
    bpp: 0.096,
    nota: "Para archivar o para vídeos cortos. Pesa el doble que la normal.",
  },
  normal: {
    id: "normal",
    nombre: "Normal (recomendada)",
    crf: 23,
    preset: "medium",
    audioKbps: 128,
    escala: 1,
    fps: null,
    bpp: 0.064,
    nota: "Misma resolución, la mitad de peso. Las redes recomprimen igual.",
  },
  ligera: {
    id: "ligera",
    nombre: "Ligera (720p, la más pequeña)",
    crf: 26,
    preset: "faster",
    audioKbps: 96,
    escala: 2 / 3,
    fps: 24,
    bpp: 0.045,
    nota: "720p a 24 fps: para vídeos largos o cuando el disco aprieta.",
  },
};

export const esCalidad = (v: string): v is Calidad => v in PERFILES;

export const perfilDe = (v?: string | null): PerfilCalidad =>
  v && esCalidad(v) ? PERFILES[v] : PERFILES.normal;

/** Los lados de un vídeo tienen que ser pares: H.264 no admite impares. */
const par = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/**
 * El lienzo real con el que se codifica. La calidad ligera reduce el tamaño y
 * los fotogramas; los rótulos se siguen calculando sobre el formato original,
 * así que se ven igual de grandes en proporción.
 */
export function aplicarCalidad(preset: Preset, calidad?: string | null): Preset {
  const p = perfilDe(calidad);
  if (p.escala === 1 && !p.fps) return preset;
  return {
    ...preset,
    ancho: par(preset.ancho * p.escala),
    alto: par(preset.alto * p.escala),
    fps: p.fps ?? preset.fps,
  };
}

export type Estimacion = {
  calidad: Calidad;
  nombre: string;
  nota: string;
  ancho: number;
  alto: number;
  fps: number;
  /** Bitrate de vídeo estimado, en bits por segundo. */
  bitrate: number;
  bytes: number;
  mb: number;
};

/**
 * Cuanto pesaria el montaje con cada calidad. `bppReal` permite afinar la
 * cuenta con lo medido en renders anteriores del mismo formato.
 */
export function estimar(
  duracion: number,
  preset: Preset,
  calidad: Calidad,
  bppReal?: number | null,
): Estimacion {
  const p = PERFILES[calidad];
  const lienzo = aplicarCalidad(preset, calidad);
  const bpp = bppReal && bppReal > 0.005 && bppReal < 0.5 ? bppReal : p.bpp;
  const bitrate = bpp * lienzo.ancho * lienzo.alto * lienzo.fps;
  const bytes = Math.round(((bitrate + p.audioKbps * 1000) * Math.max(duracion, 0)) / 8);
  return {
    calidad,
    nombre: p.nombre,
    nota: p.nota,
    ancho: lienzo.ancho,
    alto: lienzo.alto,
    fps: lienzo.fps,
    bitrate: Math.round(bitrate),
    bytes,
    mb: Math.round((bytes / (1024 * 1024)) * 10) / 10,
  };
}

/** Las tres calidades de una vez, para enseñarlas juntas y poder elegir. */
export const estimarTodas = (
  duracion: number,
  preset: Preset,
  bppPorCalidad: Partial<Record<Calidad, number>> = {},
): Estimacion[] => CALIDADES.map((c) => estimar(duracion, preset, c, bppPorCalidad[c]));

/**
 * Bits por pixel y fotograma que salieron de verdad. Con esto, la proxima
 * estimacion del mismo formato deja de ser una tabla y pasa a ser historia.
 */
export const bppMedido = (bytes: number, duracion: number, preset: Preset) =>
  duracion > 0.5 && bytes > 0
    ? (bytes * 8) / duracion / (preset.ancho * preset.alto * preset.fps)
    : null;

/**
 * Bitrate maximo de video para que el archivo quepa en `limiteBytes`. Se usa
 * como techo (VBV) junto al CRF: el codificador sigue comprimiendo por
 * calidad, pero no se pasa del tamaño. null = no hace falta limitar.
 */
export function techoBitrate(duracion: number, limiteBytes: number, calidad: Calidad, estimado: number) {
  if (duracion < 1 || limiteBytes <= 0 || estimado <= limiteBytes) return null;
  const p = PERFILES[calidad];
  // Un 6 % de margen para la cabecera del MP4 y los picos del contenedor.
  const disponible = (limiteBytes * 8 * 0.94) / duracion - p.audioKbps * 1000;
  // Si ni el audio cabe en el limite, no hay techo que salve el archivo: se
  // deja pasar y el render avisa al final con el tamaño de verdad.
  if (disponible <= 0) return null;
  // Por debajo de 150 kbps el video es una sopa de cuadros; se pone ese suelo
  // aunque el archivo acabe un poco por encima del limite.
  return Math.round(Math.max(disponible, 150_000));
}
