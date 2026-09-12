import type { Preset } from "./presets.js";
import { FUENTE_POR_DEFECTO } from "./fuentes.js";

/**
 * Rotulos del editor: texto con estilo y animacion, convertidos a ASS para que
 * ffmpeg los queme exactamente donde la vista previa los mostraba.
 */

export type Posicion = "arriba" | "centro" | "abajo";
/** `resaltar` ilumina palabra a palabra al ritmo del fragmento (karaoke ASS). */
export type Animacion = "ninguna" | "fundido" | "subir" | "zoom" | "resaltar";
/** Como se va mostrando un texto largo dentro de su escena. */
export type Lectura = "todo" | "frases" | "bloques";

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

export const ANIMACIONES: Animacion[] = ["ninguna", "fundido", "subir", "zoom", "resaltar"];
export const LECTURAS: Lectura[] = ["todo", "frases", "bloques"];

/** Palabras por bloque cuando la lectura es "bloques". */
const PALABRAS_POR_BLOQUE = 8;
/** Ningun fragmento dura menos que esto, para que de tiempo a leerlo. */
const MIN_FRAGMENTO = 1.1;

const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean);

/**
 * Parte un parrafo en trozos que se muestran uno tras otro. Por frases corta en
 * . ! ? … y pega las frases de menos de tres palabras a la anterior; por
 * bloques agrupa de ocho en ocho prefiriendo cortar en comas.
 */
export function fragmentar(texto: string, lectura: Lectura): string[] {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (!limpio) return [];
  if (lectura === "todo") return [limpio];

  if (lectura === "frases") {
    const frases = limpio.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const salida: string[] = [];
    for (const f of frases) {
      if (salida.length && palabras(f).length < 3) salida[salida.length - 1] += " " + f;
      else salida.push(f);
    }
    return salida;
  }

  // bloques
  const salida: string[] = [];
  let actual: string[] = [];
  for (const w of palabras(limpio)) {
    actual.push(w);
    const corte = actual.length >= PALABRAS_POR_BLOQUE || (actual.length >= 5 && /[,;:]$/.test(w));
    if (corte) {
      salida.push(actual.join(" "));
      actual = [];
    }
  }
  if (actual.length) {
    // Un resto de una o dos palabras se pega al bloque anterior.
    if (salida.length && actual.length <= 2) salida[salida.length - 1] += " " + actual.join(" ");
    else salida.push(actual.join(" "));
  }
  return salida;
}

/**
 * Reparte la duracion de la escena entre sus fragmentos, proporcional a las
 * palabras de cada uno y con un minimo por fragmento cuando cabe.
 */
export function repartirTiempo(fragmentos: string[], duracion: number): number[] {
  const pesos = fragmentos.map((f) => Math.max(palabras(f).length, 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  let tiempos = pesos.map((p) => (duracion * p) / total);
  if (duracion >= fragmentos.length * MIN_FRAGMENTO) {
    // Sube los que quedan cortos y descuenta proporcionalmente del resto.
    const cortos = tiempos.filter((t) => t < MIN_FRAGMENTO).length;
    if (cortos) {
      const deficit = tiempos.reduce((s, t) => s + Math.max(MIN_FRAGMENTO - t, 0), 0);
      const largos = tiempos.reduce((s, t) => s + (t > MIN_FRAGMENTO ? t - MIN_FRAGMENTO : 0), 0);
      tiempos = tiempos.map((t) =>
        t < MIN_FRAGMENTO ? MIN_FRAGMENTO : t - ((t - MIN_FRAGMENTO) / largos) * deficit,
      );
    }
  }
  return tiempos;
}

/** Karaoke ASS: cada palabra se ilumina durante su parte del fragmento. */
function conKaraoke(texto: string, segundos: number) {
  const ws = palabras(texto);
  const pesos = ws.map((w) => w.length + 1);
  const total = pesos.reduce((a, b) => a + b, 0);
  return ws
    .map((w, i) => `{\\kf${Math.max(1, Math.round((segundos * 100 * pesos[i]) / total))}}${w}`)
    .join(" ");
}

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

/** Color apagado del karaoke: gris medio, se ve sobre casi cualquier clip. */
const SECUNDARIO_APAGADO = "&H00909090&";

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
    case "resaltar":
      return `${base}\\pos(${x},${y})\\2c${SECUNDARIO_APAGADO}\\fad(150,150)`;
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
  lectura?: Lectura;
};

/** Una linea ASS por fragmento; con `resaltar`, ademas, karaoke por palabra. */
function lineasDe(r: Rotulo, p: Preset): string[] {
  const fragmentos = fragmentar(r.texto, r.lectura ?? "todo");
  if (!fragmentos.length) return [];
  const duracion = Math.max(r.fin - r.inicio, 0.2);
  const tiempos = repartirTiempo(fragmentos, duracion);
  const tags = etiquetas(r.estilo, r.animacion, p);

  let t = r.inicio;
  return fragmentos.map((f, i) => {
    const ini = t;
    const fin = i === fragmentos.length - 1 ? r.fin : t + tiempos[i];
    t = fin;
    const cuerpo = r.animacion === "resaltar" ? conKaraoke(limpiar(f), fin - ini) : limpiar(f);
    return `Dialogue: 0,${tiempo(ini)},${tiempo(fin)},Rotulo,,0,0,0,,{${tags}}${cuerpo}`;
  });
}

export function crearASSProyecto(rotulos: Rotulo[], p: Preset) {
  const margen = Math.round(p.ancho * 0.08);
  const lineas = rotulos.flatMap((r) => lineasDe(r, p)).join("\n");

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
