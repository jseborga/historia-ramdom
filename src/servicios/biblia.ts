import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { gunzipSync } from "node:zlib";

/**
 * El texto bíblico, para que las citas sean exactas.
 *
 * Una cita que escribe la IA de memoria puede existir y no decir lo que se
 * cuenta, o directamente no existir. Por eso la app lleva dentro la Biblia
 * entera —Reina-Valera 1909, de dominio público, ver `biblia/README.md`— y
 * todas las citas de «Aprendiendo con la Biblia» se comprueban contra ella:
 * que el libro, el capítulo y el versículo existan, y, cuando se puede, que
 * el texto diga lo que se cuenta (unas palabras clave que tienen que estar).
 *
 * Se lee una vez, la primera vez que hace falta, y se queda en memoria: son
 * cuatro megas de texto y treinta y un mil versículos.
 */

export type Testamento = "AT" | "NT";

export type Libro = {
  /** 1 a 66, en el orden de las biblias protestantes en español. */
  numero: number;
  nombre: string;
  /** El código del archivo de eBible. */
  codigo: string;
  testamento: Testamento;
  /** Otras formas de escribirlo: abreviaturas y sin tilde. */
  alias: string[];
};

const L = (numero: number, nombre: string, codigo: string, alias: string[] = []): Libro => ({
  numero,
  nombre,
  codigo,
  testamento: numero <= 39 ? "AT" : "NT",
  alias,
});

export const LIBROS: Libro[] = [
  L(1, "Génesis", "GEN", ["gen", "gn"]),
  L(2, "Éxodo", "EXO", ["ex", "exo"]),
  L(3, "Levítico", "LEV", ["lev", "lv"]),
  L(4, "Números", "NUM", ["num", "nm"]),
  L(5, "Deuteronomio", "DEU", ["deut", "dt"]),
  L(6, "Josué", "JOS", ["jos"]),
  L(7, "Jueces", "JDG", ["jue", "jc"]),
  L(8, "Rut", "RUT", ["rt"]),
  L(9, "1 Samuel", "1SA", ["1 sam", "1 s"]),
  L(10, "2 Samuel", "2SA", ["2 sam", "2 s"]),
  L(11, "1 Reyes", "1KI", ["1 re", "1 r"]),
  L(12, "2 Reyes", "2KI", ["2 re", "2 r"]),
  L(13, "1 Crónicas", "1CH", ["1 cr", "1 cro", "1 cron"]),
  L(14, "2 Crónicas", "2CH", ["2 cr", "2 cro", "2 cron"]),
  L(15, "Esdras", "EZR", ["esd"]),
  L(16, "Nehemías", "NEH", ["neh"]),
  L(17, "Ester", "EST", ["est"]),
  L(18, "Job", "JOB", []),
  L(19, "Salmos", "PSA", ["salmo", "sal", "sl"]),
  L(20, "Proverbios", "PRO", ["prov", "pr"]),
  L(21, "Eclesiastés", "ECC", ["ecl", "ec"]),
  L(22, "Cantares", "SOL", ["cant", "cnt", "cantar de los cantares"]),
  L(23, "Isaías", "ISA", ["is", "isa"]),
  L(24, "Jeremías", "JER", ["jer"]),
  L(25, "Lamentaciones", "LAM", ["lam"]),
  L(26, "Ezequiel", "EZE", ["ez", "eze"]),
  L(27, "Daniel", "DAN", ["dan", "dn"]),
  L(28, "Oseas", "HOS", ["os"]),
  L(29, "Joel", "JOE", ["jl"]),
  L(30, "Amós", "AMO", ["am"]),
  L(31, "Abdías", "OBA", ["abd"]),
  L(32, "Jonás", "JON", ["jon"]),
  L(33, "Miqueas", "MIC", ["miq"]),
  L(34, "Nahúm", "NAH", ["nah"]),
  L(35, "Habacuc", "HAB", ["hab"]),
  L(36, "Sofonías", "ZEP", ["sof"]),
  L(37, "Hageo", "HAG", ["hag"]),
  L(38, "Zacarías", "ZEC", ["zac"]),
  L(39, "Malaquías", "MAL", ["mal"]),
  L(40, "Mateo", "MAT", ["mt", "mat"]),
  L(41, "Marcos", "MAR", ["mr", "mc", "mar"]),
  L(42, "Lucas", "LUK", ["lc", "luc"]),
  L(43, "Juan", "JOH", ["jn"]),
  L(44, "Hechos", "ACT", ["hch", "hech", "hechos de los apostoles"]),
  L(45, "Romanos", "ROM", ["ro", "rom"]),
  L(46, "1 Corintios", "1CO", ["1 cor", "1 co"]),
  L(47, "2 Corintios", "2CO", ["2 cor", "2 co"]),
  L(48, "Gálatas", "GAL", ["gal", "ga"]),
  L(49, "Efesios", "EPH", ["ef", "efe"]),
  L(50, "Filipenses", "PHI", ["fil", "flp"]),
  L(51, "Colosenses", "COL", ["col"]),
  L(52, "1 Tesalonicenses", "1TH", ["1 tes", "1 ts"]),
  L(53, "2 Tesalonicenses", "2TH", ["2 tes", "2 ts"]),
  L(54, "1 Timoteo", "1TI", ["1 tim", "1 ti"]),
  L(55, "2 Timoteo", "2TI", ["2 tim", "2 ti"]),
  L(56, "Tito", "TIT", ["tit"]),
  L(57, "Filemón", "PHM", ["flm", "filem"]),
  L(58, "Hebreos", "HEB", ["heb"]),
  L(59, "Santiago", "JAM", ["stg", "sant"]),
  L(60, "1 Pedro", "1PE", ["1 pe", "1 ped"]),
  L(61, "2 Pedro", "2PE", ["2 pe", "2 ped"]),
  L(62, "1 Juan", "1JO", ["1 jn"]),
  L(63, "2 Juan", "2JO", ["2 jn"]),
  L(64, "3 Juan", "3JO", ["3 jn"]),
  L(65, "Judas", "JUD", ["jud"]),
  L(66, "Apocalipsis", "REV", ["ap", "apoc"]),
];

/** Sin tildes, en minúsculas y sin puntuación: para comparar, nunca para enseñar. */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "1 reyes", "1re", "i reyes", "primera de reyes"... todos a "1 reyes". */
function claveLibro(texto: string): string {
  return normalizar(texto)
    .replace(/^(primera|primero|1ra|1a|i)\s+(de\s+)?/, "1 ")
    .replace(/^(segunda|segundo|2da|2a|ii)\s+(de\s+)?/, "2 ")
    .replace(/^(tercera|tercero|3ra|3a|iii)\s+(de\s+)?/, "3 ")
    .replace(/^([123])\s*/, "$1 ")
    .trim();
}

const POR_NOMBRE = new Map<string, Libro>();
for (const l of LIBROS) {
  for (const n of [l.nombre, ...l.alias]) POR_NOMBRE.set(claveLibro(n), l);
}

export const libroPorNumero = (n: number) => LIBROS[n - 1];
export const libroPorNombre = (texto: string) => POR_NOMBRE.get(claveLibro(texto));

// ---------------------------------------------------------------------------
// El texto
// ---------------------------------------------------------------------------

type Texto = {
  versos: Map<string, string>;
  /** Versículos por capítulo: [libro][capítulo] = último versículo. */
  capitulos: Map<number, number[]>;
};

let cargado: Texto | null = null;

const clave = (libro: number, capitulo: number, versiculo: number) => `${libro}:${capitulo}:${versiculo}`;

function cargar(): Texto {
  if (cargado) return cargado;
  const ruta = resolve(process.cwd(), "biblia", "rv1909.txt.gz");
  const lineas = gunzipSync(readFileSync(ruta)).toString("utf8").split("\n");
  const porCodigo = new Map(LIBROS.map((l) => [l.codigo, l.numero]));
  const versos = new Map<string, string>();
  const capitulos = new Map<number, number[]>();
  for (const linea of lineas) {
    const m = /^([1-3A-Z]{3}) (\d+):(\d+) (.*)$/.exec(linea.trim());
    if (!m) continue;
    const libro = porCodigo.get(m[1]);
    if (!libro) continue;
    const cap = Number(m[2]);
    const ver = Number(m[3]);
    // Los corchetes marcan lo que añadieron los traductores: se lee igual.
    versos.set(clave(libro, cap, ver), m[4].replace(/\[([^\]]*)\]/g, "$1").trim());
    const lista = capitulos.get(libro) ?? [];
    lista[cap] = Math.max(lista[cap] ?? 0, ver);
    capitulos.set(libro, lista);
  }
  if (versos.size < 30_000) throw new Error("El texto bíblico está incompleto (biblia/rv1909.txt.gz)");
  cargado = { versos, capitulos };
  return cargado;
}

/** Cuántos capítulos tiene un libro. */
export function capitulosDe(libro: number): number {
  return (cargar().capitulos.get(libro)?.length ?? 1) - 1;
}

/** Cuántos versículos tiene un capítulo (0 si no existe). */
export function versiculosDe(libro: number, capitulo: number): number {
  return cargar().capitulos.get(libro)?.[capitulo] ?? 0;
}

export const versiculo = (libro: number, capitulo: number, v: number) => cargar().versos.get(clave(libro, capitulo, v));

// ---------------------------------------------------------------------------
// Citas
// ---------------------------------------------------------------------------

/** Un pasaje: de un versículo a otro, en el mismo capítulo o cruzando. */
export type Pasaje = {
  libro: number;
  capitulo: number;
  versiculo: number;
  capituloFin: number;
  versiculoFin: number;
};

/** De Génesis 1:1 a Apocalipsis 22:21, en un número: ordena la serie. */
export const ordenDe = (p: Pick<Pasaje, "libro" | "capitulo" | "versiculo">) =>
  p.libro * 1_000_000 + p.capitulo * 1_000 + p.versiculo;

const CITA =
  /^\s*((?:[123]|i{1,3}|primera|primero|segunda|segundo|tercera|tercero)\s*(?:de\s+)?)?([a-záéíóúüñ]+(?:\s+(?:de\s+los\s+)?[a-záéíóúüñ]+)*)\.?\s*(\d{1,3})(?:\s*[:.,]\s*(\d{1,3}))?(?:\s*[-–]\s*(\d{1,3})(?:\s*[:.,]\s*(\d{1,3}))?)?\s*$/i;

/**
 * Lee una cita: «Levítico 11:10», «Lev 11:7-8», «Génesis 29:21-30:4»,
 * «Salmo 51» (el capítulo entero), «Jueces 11-12». Devuelve null si no se
 * entiende o si el pasaje no existe en el texto.
 */
export function leerCita(texto: string): Pasaje | null {
  const m = CITA.exec(texto.trim());
  if (!m) return null;
  const libro = libroPorNombre(`${m[1] ?? ""}${m[2]}`);
  if (!libro) return null;
  const c1 = Number(m[3]);
  const v1 = m[4] ? Number(m[4]) : null;
  const a = m[5] ? Number(m[5]) : null;
  const b = m[6] ? Number(m[6]) : null;

  let p: Pasaje;
  if (v1 === null) {
    // Capítulos enteros: «Salmo 51», «Génesis 29-30».
    const cFin = a ?? c1;
    p = { libro: libro.numero, capitulo: c1, versiculo: 1, capituloFin: cFin, versiculoFin: versiculosDe(libro.numero, cFin) };
  } else if (a === null) {
    p = { libro: libro.numero, capitulo: c1, versiculo: v1, capituloFin: c1, versiculoFin: v1 };
  } else if (b === null) {
    p = { libro: libro.numero, capitulo: c1, versiculo: v1, capituloFin: c1, versiculoFin: a };
  } else {
    p = { libro: libro.numero, capitulo: c1, versiculo: v1, capituloFin: a, versiculoFin: b };
  }
  return pasajeValido(p) ? p : null;
}

export function pasajeValido(p: Pasaje): boolean {
  if (!libroPorNumero(p.libro)) return false;
  const inicio = versiculosDe(p.libro, p.capitulo);
  const fin = versiculosDe(p.libro, p.capituloFin);
  if (!inicio || !fin) return false;
  if (p.versiculo < 1 || p.versiculo > inicio || p.versiculoFin < 1 || p.versiculoFin > fin) return false;
  return ordenDe(p) <= ordenDe({ libro: p.libro, capitulo: p.capituloFin, versiculo: p.versiculoFin });
}

/** «Levítico 11:10», «Levítico 11:7-8», «Génesis 29:21-30:4», «Salmo 51». */
export function formatearCita(p: Pasaje): string {
  const libro = libroPorNumero(p.libro);
  const nombre = p.libro === 19 && p.capitulo === p.capituloFin ? "Salmo" : libro.nombre;
  const enteros = p.versiculo === 1 && p.versiculoFin === versiculosDe(p.libro, p.capituloFin);
  if (enteros && versiculosDe(p.libro, p.capitulo) > 1) {
    return p.capitulo === p.capituloFin ? `${nombre} ${p.capitulo}` : `${nombre} ${p.capitulo}-${p.capituloFin}`;
  }
  if (p.capitulo !== p.capituloFin) return `${nombre} ${p.capitulo}:${p.versiculo}-${p.capituloFin}:${p.versiculoFin}`;
  if (p.versiculo === p.versiculoFin) return `${nombre} ${p.capitulo}:${p.versiculo}`;
  return `${nombre} ${p.capitulo}:${p.versiculo}-${p.versiculoFin}`;
}

/** Los versículos del pasaje, en orden. */
export function versiculosDelPasaje(p: Pasaje): { capitulo: number; versiculo: number; texto: string }[] {
  const salida: { capitulo: number; versiculo: number; texto: string }[] = [];
  for (let c = p.capitulo; c <= p.capituloFin; c++) {
    const desde = c === p.capitulo ? p.versiculo : 1;
    const hasta = c === p.capituloFin ? p.versiculoFin : versiculosDe(p.libro, c);
    for (let v = desde; v <= hasta; v++) {
      const texto = versiculo(p.libro, c, v);
      if (texto) salida.push({ capitulo: c, versiculo: v, texto });
    }
  }
  return salida;
}

/** El texto del pasaje seguido, tal cual. */
export function textoDelPasaje(p: Pasaje): string {
  return versiculosDelPasaje(p)
    .map((x) => x.texto)
    .join(" ");
}

/**
 * ¿Dice el pasaje lo que se cuenta? Cada palabra clave tiene que estar en el
 * texto (sin tildes ni mayúsculas, que la ortografía de 1909 no es la de hoy).
 * Devuelve las que faltan.
 */
export function clavesQueFaltan(p: Pasaje, claves: string[]): string[] {
  const texto = ` ${normalizar(textoDelPasaje(p))} `;
  return claves.filter((c) => !texto.includes(normalizar(c)));
}

export type CitaEncontrada = { original: string; cita: string | null; texto: string | null };

/**
 * Las citas entre paréntesis de un texto: «(Marcos 7:19)», «(Éxodo 20:12;
 * Efesios 6:2)». Cada una, comprobada: si no existe, `cita` es null.
 */
export function citasEn(texto: string): CitaEncontrada[] {
  const salida: CitaEncontrada[] = [];
  for (const m of texto.matchAll(/\(([^()]{3,80})\)/g)) {
    let libroAnterior = "";
    for (const parte of m[1].split(/;/)) {
      const limpia = parte.trim();
      if (!/\d/.test(limpia)) continue;
      // «(Génesis 12:13; 20:2)»: la segunda hereda el libro de la primera.
      const conLibro = /^[\d\s:.,–-]+$/.test(limpia) && libroAnterior ? `${libroAnterior} ${limpia}` : limpia;
      const p = leerCita(conLibro);
      if (p) libroAnterior = libroPorNumero(p.libro).nombre;
      salida.push({ original: limpia, cita: p ? formatearCita(p) : null, texto: p ? textoDelPasaje(p) : null });
    }
  }
  return salida;
}

/** Quita la cita del final de una frase: la app la pone siempre ella. */
export function sinCitaFinal(frase: string): string {
  return frase
    .replace(/\s*\(([^()]{3,80})\)\s*([.!?…]*)\s*$/, (todo, dentro: string, punto: string) =>
      leerCita(dentro.split(";")[0]) ? punto || "" : todo,
    )
    .trim();
}

/** La frase con su cita al final, como va en pantalla. */
export function conCita(frase: string, p: Pasaje): string {
  const base = sinCitaFinal(frase).replace(/[.!?…]+$/, "");
  return `${base} (${formatearCita(p)}).`;
}
