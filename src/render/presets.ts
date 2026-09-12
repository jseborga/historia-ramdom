/**
 * Formatos de salida por red. El lienzo manda: todo el render (clips, texto y
 * animaciones) se calcula sobre estas dimensiones, y la vista previa del editor
 * usa la misma relacion de aspecto.
 */
/** Tope duro de cualquier vídeo que produce la app, en segundos. */
export const MAX_DURACION_SEG = 350;

export type Preset = {
  id: string;
  nombre: string;
  ancho: number;
  alto: number;
  fps: number;
  /** Duracion recomendada; solo se avisa, no se corta. */
  maxSegundos: number;
  nota: string;
};

export const PRESETS: Preset[] = [
  {
    id: "tiktok",
    nombre: "TikTok / Reels / Shorts",
    ancho: 1080,
    alto: 1920,
    fps: 30,
    maxSegundos: MAX_DURACION_SEG,
    nota: "Vertical 9:16. Los subtítulos se suben para que no los tape la interfaz.",
  },
  {
    id: "instagram_feed",
    nombre: "Instagram feed (4:5)",
    ancho: 1080,
    alto: 1350,
    fps: 30,
    maxSegundos: 90,
    nota: "Vertical suave 4:5, el que mas ocupa en el feed.",
  },
  {
    id: "cuadrado",
    nombre: "Cuadrado (1:1)",
    ancho: 1080,
    alto: 1080,
    fps: 30,
    maxSegundos: 90,
    nota: "Sirve igual en Instagram, Facebook y LinkedIn.",
  },
  {
    id: "youtube",
    nombre: "YouTube (16:9)",
    ancho: 1920,
    alto: 1080,
    fps: 30,
    maxSegundos: MAX_DURACION_SEG,
    nota: "Horizontal clásico para YouTube o Facebook.",
  },
  {
    id: "facebook",
    nombre: "Facebook historia (9:16)",
    ancho: 1080,
    alto: 1920,
    fps: 30,
    maxSegundos: 60,
    nota: "Vertical, como las historias de Facebook e Instagram.",
  },
];

export const PRESET_POR_DEFECTO = PRESETS[0];

export const buscarPreset = (id: string) =>
  PRESETS.find((p) => p.id === id) ?? PRESET_POR_DEFECTO;

/** Encaja cualquier clip en el lienzo del preset, recortando. Sin formato final. */
export const filtroEncaje = (p: Preset) =>
  `scale=${p.ancho}:${p.alto}:force_original_aspect_ratio=increase,` +
  `crop=${p.ancho}:${p.alto},setsar=1,fps=${p.fps}`;

/** Filtro completo del lienzo, con el formato de pixel al final. */
export const filtroLienzo = (p: Preset) => `${filtroEncaje(p)},format=yuv420p`;

export type Efecto = "ninguno" | "zoomLento" | "fundido" | "blancoYNegro" | "vineta";
export const EFECTOS: Efecto[] = ["ninguno", "zoomLento", "fundido", "blancoYNegro", "vineta"];

/**
 * Efecto de imagen de una escena, ya sobre el lienzo. `d` es la duracion en
 * segundos: el zoom avanza con el tiempo y el fundido sabe cuando acabar.
 */
export function filtroEfecto(efecto: Efecto, p: Preset, d: number): string {
  const D = Math.max(d, 0.5).toFixed(3);
  switch (efecto) {
    case "zoomLento": {
      // Acercamiento lento tipo Ken Burns. Con `crop` no vale: sus expresiones
      // de ancho y alto se evalúan una sola vez y no conocen `t`. `zoompan` sí
      // avanza por fotograma (`in` = número de fotograma de entrada, d=1 = un
      // fotograma de salida por cada uno de entrada).
      const fotogramas = Math.max(1, Math.round(p.fps * Number(D)));
      return (
        `zoompan=z='min(1+0.12*in/${fotogramas},1.12)':` +
        `x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${p.ancho}x${p.alto}:fps=${p.fps}`
      );
    }
    case "fundido": {
      const f = Math.min(0.5, d / 3).toFixed(3);
      return `fade=t=in:st=0:d=${f},fade=t=out:st=${(d - Number(f)).toFixed(3)}:d=${f}`;
    }
    case "blancoYNegro":
      return "hue=s=0";
    case "vineta":
      return "vignette=PI/4.5";
    default:
      return "";
  }
}

/** Lienzo + efecto + formato, listo para -vf. */
export const filtroEscena = (p: Preset, efecto: Efecto, d: number) =>
  [filtroEncaje(p), filtroEfecto(efecto, p, d), "format=yuv420p"].filter(Boolean).join(",");
