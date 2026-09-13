/**
 * Formatos de salida por red. El lienzo manda: todo el render (clips, texto y
 * animaciones) se calcula sobre estas dimensiones, y la vista previa del editor
 * usa la misma relacion de aspecto.
 */
/** Tope duro de un vídeo corto, en segundos. */
export const MAX_DURACION_SEG = 350;

/**
 * Tope de los formatos largos (capítulos de miniserie). Un vídeo así pesa
 * mucho: conviene renderizarlo con calidad ligera, y el estimador avisa.
 */
export const MAX_LARGO_SEG = 900;

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
    id: "vertical_largo",
    nombre: "Vertical largo (9:16, miniserie)",
    ancho: 1080,
    alto: 1920,
    fps: 30,
    maxSegundos: MAX_LARGO_SEG,
    nota: "Hasta 15 min en vertical: capítulos de miniserie para TikTok o Shorts largos.",
  },
  {
    id: "youtube_largo",
    nombre: "YouTube largo (16:9, miniserie)",
    ancho: 1920,
    alto: 1080,
    fps: 30,
    maxSegundos: MAX_LARGO_SEG,
    nota: "Horizontal hasta 15 min: el capítulo entero para YouTube.",
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

/** Segundos que admite un formato: los cortos, 350; los largos, lo suyo. */
export const topeDeFormato = (id: string) => Math.max(buscarPreset(id).maxSegundos, MAX_DURACION_SEG);

/** ¿Es un formato de los largos (miniserie)? */
export const esFormatoLargo = (id: string) => buscarPreset(id).maxSegundos > MAX_DURACION_SEG;

/** Encaja cualquier clip en el lienzo del preset, recortando. Sin formato final. */
export const filtroEncaje = (p: Preset) =>
  `scale=${p.ancho}:${p.alto}:force_original_aspect_ratio=increase,` +
  `crop=${p.ancho}:${p.alto},setsar=1,fps=${p.fps}`;

/** Filtro completo del lienzo, con el formato de pixel al final. */
export const filtroLienzo = (p: Preset) => `${filtroEncaje(p)},format=yuv420p`;

export type Efecto =
  | "ninguno"
  | "zoomLento"
  | "alejar"
  | "paneoDerecha"
  | "paneoIzquierda"
  | "kenBurns"
  | "fundido"
  | "blancoYNegro"
  | "vineta";

export const EFECTOS: Efecto[] = [
  "ninguno",
  "zoomLento",
  "alejar",
  "paneoDerecha",
  "paneoIzquierda",
  "kenBurns",
  "fundido",
  "blancoYNegro",
  "vineta",
];

/**
 * Los que mueven la cámara. Una foto quieta en un vertical parece un error;
 * con uno de estos parece animación, que es justo para lo que están.
 */
export const MOVIMIENTOS: Efecto[] = ["zoomLento", "alejar", "paneoDerecha", "paneoIzquierda", "kenBurns"];

export const esMovimiento = (e: Efecto) => MOVIMIENTOS.includes(e);

/** Movimiento distinto para cada foto seguida, para que no se note el truco. */
export const movimientoPorIndice = (i: number): Efecto => MOVIMIENTOS[Math.abs(i) % MOVIMIENTOS.length];

/**
 * Efecto de imagen de una escena, ya sobre el lienzo. `d` es la duracion en
 * segundos: el zoom avanza con el tiempo y el fundido sabe cuando acabar.
 *
 * Los movimientos son `zoompan`: con `crop` no vale, porque sus expresiones de
 * ancho y alto se evalúan una sola vez y no conocen `t`. `zoompan` sí avanza
 * por fotograma (`in` = número de fotograma de entrada; `d=1` = un fotograma
 * de salida por cada uno de entrada). La ventana que recorta mide `iw/zoom` x
 * `ih/zoom`, así que el desplazamiento máximo es `iw-iw/zoom`.
 */
export function filtroEfecto(efecto: Efecto, p: Preset, d: number): string {
  const D = Math.max(d, 0.5);
  const n = Math.max(1, Math.round(p.fps * D));
  const lienzo = `d=1:s=${p.ancho}x${p.alto}:fps=${p.fps}`;
  const centro = { x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" };
  const mover = (z: string, x: string, y: string) => `zoompan=z='${z}':x='${x}':y='${y}':${lienzo}`;

  switch (efecto) {
    case "zoomLento":
      return mover(`min(1+0.12*in/${n},1.12)`, centro.x, centro.y);
    case "alejar":
      return mover(`max(1.12-0.12*in/${n},1.001)`, centro.x, centro.y);
    case "paneoDerecha":
      return mover("1.12", `(iw-iw/zoom)*min(in/${n},1)`, centro.y);
    case "paneoIzquierda":
      return mover("1.12", `(iw-iw/zoom)*(1-min(in/${n},1))`, centro.y);
    case "kenBurns":
      return mover(
        `min(1+0.16*in/${n},1.16)`,
        `(iw-iw/zoom)*min(in/${n},1)`,
        `(ih-ih/zoom)*min(in/${n},1)`,
      );
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

/**
 * Lienzo + efecto + formato, listo para -vf.
 *
 * Con `imagen`, la foto se amplía al doble del lienzo antes de moverla —así el
 * zoom no la emborrona— y se le garantiza movimiento: si el efecto elegido no
 * mueve nada (blanco y negro, viñeta, ninguno), se le añade un Ken Burns
 * debajo. Una foto sin movimiento en un vídeo vertical canta muchísimo.
 */
export function filtroEscena(p: Preset, efecto: Efecto, d: number, imagen = false): string {
  if (!imagen) return [filtroEncaje(p), filtroEfecto(efecto, p, d), "format=yuv420p"].filter(Boolean).join(",");

  const doble = { ...p, ancho: p.ancho * 2, alto: p.alto * 2 };
  const movimiento = esMovimiento(efecto) ? efecto : "kenBurns";
  const extra = esMovimiento(efecto) ? "" : filtroEfecto(efecto, p, d);
  return [
    // El encaje va al doble de tamaño: zoompan recorta de ahí y baja al lienzo.
    `scale=${doble.ancho}:${doble.alto}:force_original_aspect_ratio=increase`,
    `crop=${doble.ancho}:${doble.alto}`,
    "setsar=1",
    filtroEfecto(movimiento, p, d),
    extra,
    "format=yuv420p",
  ]
    .filter(Boolean)
    .join(",");
}

/** Entrada de ffmpeg para una foto: se repite el fotograma a la cadencia del lienzo. */
export const entradaImagen = (p: Preset, archivo: string, d: number) => [
  "-framerate", String(p.fps),
  "-loop", "1",
  "-i", archivo,
  "-t", d.toFixed(3),
];
