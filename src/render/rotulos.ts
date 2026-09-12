import type { Preset } from "./presets.js";
import { FUENTE_POR_DEFECTO } from "./fuentes.js";

/**
 * Rotulos del editor: texto con estilo y animacion, convertidos a ASS para que
 * ffmpeg los queme exactamente donde la vista previa los mostraba.
 */

export type Posicion = "arriba" | "centro" | "abajo";
export type Animacion = "ninguna" | "fundido" | "subir" | "zoom";

export type EstiloTexto = {
  /** Nombre de familia tal como lo conoce libass (DejaVu Serif, Lato...). */
  fuente: string;
  tamano: number;
  color: string; // #RRGGBB
  contorno: string; // #RRGGBB
  posicion: Posicion;
  negrita: boolean;
};

export const ESTILO_POR_DEFECTO: EstiloTexto = {
  fuente: FUENTE_POR_DEFECTO,
  tamano: 66,
  color: "#FFFFFF",
  contorno: "#000000",
  posicion: "abajo",
  negrita: false,
};

export const ANIMACIONES: Animacion[] = ["ninguna", "fundido", "subir", "zoom"];

/** ASS usa &HBBGGRR&, al reves que el #RRGGBB del navegador. */
export function colorASS(hex: string) {
  const limpio = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!limpio) return "&H00FFFFFF&";
  const [r, g, b] = [0, 2, 4].map((i) => limpio[1].slice(i, i + 2).toUpperCase());
  return `&H00${b}${g}${r}&`;
}

/** Altura del rotulo dentro del lienzo, como fraccion del alto. */
const ALTURA: Record<Posicion, number> = { arriba: 0.2, centro: 0.5, abajo: 0.76 };

const tiempo = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${seg}`;
};

/** ASS interpreta \, { y } como comandos: fuera del texto del usuario. */
const limpiar = (t: string) =>
  t.replace(/[\\{}]/g, "").replace(/\r?\n/g, "\\N").replace(/[ \t]+/g, " ").trim();

function etiquetas(estilo: EstiloTexto, animacion: Animacion, p: Preset) {
  const x = Math.round(p.ancho / 2);
  const y = Math.round(p.alto * ALTURA[estilo.posicion]);
  // El nombre de fuente va entre \fn y la siguiente barra: sin barras ni llaves dentro.
  const fuente = estilo.fuente.replace(/[\\{}]/g, "").trim() || FUENTE_POR_DEFECTO;
  const base =
    `\\an5\\fn${fuente}\\fs${estilo.tamano}\\c${colorASS(estilo.color)}` +
    `\\3c${colorASS(estilo.contorno)}\\bord4\\shad2\\b${estilo.negrita ? 1 : 0}`;

  switch (animacion) {
    case "fundido":
      return `${base}\\pos(${x},${y})\\fad(300,300)`;
    case "subir":
      return `${base}\\move(${x},${y + 70},${x},${y},0,350)\\fad(200,200)`;
    case "zoom":
      return `${base}\\pos(${x},${y})\\fscx82\\fscy82\\t(0,350,\\fscx100\\fscy100)\\fad(200,200)`;
    default:
      return `${base}\\pos(${x},${y})`;
  }
}

export type Rotulo = {
  inicio: number;
  fin: number;
  texto: string;
  estilo: EstiloTexto;
  animacion: Animacion;
};

export function crearASSProyecto(rotulos: Rotulo[], p: Preset) {
  const margen = Math.round(p.ancho * 0.08);
  const lineas = rotulos
    .filter((r) => r.texto.trim())
    .map(
      (r) =>
        `Dialogue: 0,${tiempo(r.inicio)},${tiempo(r.fin)},Rotulo,,0,0,0,,` +
        `{${etiquetas(r.estilo, r.animacion, p)}}${limpiar(r.texto)}`,
    )
    .join("\n");

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${p.ancho}
PlayResY: ${p.alto}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Rotulo,DejaVu Serif,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,4,2,5,${margen},${margen},60,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lineas}
`;
}
