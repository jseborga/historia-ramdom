/**
 * Formatos de salida por red. El lienzo manda: todo el render (clips, texto y
 * animaciones) se calcula sobre estas dimensiones, y la vista previa del editor
 * usa la misma relacion de aspecto.
 */
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
    maxSegundos: 180,
    nota: "Vertical 9:16. Los subtitulos se suben para que no los tape la interfaz.",
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
    maxSegundos: 600,
    nota: "Horizontal clasico para YouTube o Facebook.",
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

/** Filtro que encaja cualquier clip en el lienzo del preset, recortando. */
export const filtroLienzo = (p: Preset) =>
  `scale=${p.ancho}:${p.alto}:force_original_aspect_ratio=increase,` +
  `crop=${p.ancho}:${p.alto},setsar=1,fps=${p.fps},format=yuv420p`;
