import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ESTILO_POR_DEFECTO } from "../render/rotulos.js";
import {
  ClipPistaSchema,
  RotuloPistaSchema,
  efectoDeClip,
  type ClipPista,
  type RotuloPista,
} from "./proyecto.js";
import {
  esMotor,
  extraerJSON,
  ortografia,
  textoConMotor,
  type InformeMotor,
} from "./guion.js";
import type { ClipInfo } from "./clips.js";

/**
 * **Sad but true**: el formato más corto de todos y el más rígido, que es
 * justo lo que lo hace funcionar.
 *
 *   1. Pantalla negra. Palabras sueltas pasando una tras otra, como un sorteo
 *      que va frenando.
 *   2. Se para en el arranque de la frase que gana, en amarillo, casi un segundo.
 *   3. Corte a un vídeo cualquiera, cinco segundos, con la frase que le toca a
 *      esa palabra: incómoda, no cruel.
 *   4. Se disuelve a negro y ahí queda el remate, una frase de filosofía de
 *      vida que se desvanece.
 *
 * No hay voz ni narración: son diez segundos de leer. Por eso el guion es tan
 * poco —unas palabras, una frase y un remate— y en cambio los tiempos van
 * medidos aquí y no a ojo en el editor.
 */

/** El humor con el que cierra el remate. */
export const TONOS = ["feliz", "triste", "reflexiva", "desmotivadora"] as const;
export type Tono = (typeof TONOS)[number];

export const NOMBRES_TONO: Record<Tono, string> = {
  feliz: "feliz (algo que salva el día)",
  triste: "triste (sin consuelo, pero sin crueldad)",
  reflexiva: "reflexiva (deja pensando)",
  desmotivadora: "desmotivadora (la verdad que nadie pide)",
};

export const SadButTrueSchema = z.object({
  titulo: z.string().min(1).max(120),
  /** Las del sorteo. Cortas: tienen que leerse en una décima de segundo. */
  palabras: z.array(z.string().min(1).max(40)).min(4).max(14),
  /** La que gana el sorteo. Siempre una de las de arriba. */
  elegida: z.string().min(1).max(40),
  /** La ligeramente desmotivadora, la que va sobre el vídeo. */
  frase: z.string().min(1).max(300),
  /** El cierre sobre negro: filosofía de vida, del humor que se haya pedido. */
  remate: z.string().min(1).max(300),
  tono: z.enum(TONOS).default("reflexiva"),
  /** EN INGLÉS: con esto se busca el vídeo del medio. */
  keywords: z.array(z.string().min(1).max(40)).min(1).max(6),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
  motorUsado: z.string().max(20).optional(),
  avisoMotor: z.string().max(300).optional(),
});

export type SadButTrue = z.infer<typeof SadButTrueSchema>;

const limpiar = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

/**
 * Arregla lo que los modelos fallan aquí una y otra vez, que siempre es lo
 * mismo: devolver como elegida una palabra que no está en la lista del
 * sorteo. Si se dejara pasar, el vídeo enseñaría un sorteo entre unas
 * palabras y se pararía en otra distinta, que es exactamente el truco al
 * descubierto. Se mete en la lista en vez de rechazar el guion entero.
 */
export function repararSadButTrue(crudo: unknown): unknown {
  if (!crudo || typeof crudo !== "object") return crudo;
  const d = { ...(crudo as Record<string, unknown>) };

  const palabras = Array.isArray(d.palabras) ? d.palabras.map(limpiar).filter(Boolean) : [];
  const elegida = limpiar(d.elegida) || palabras[0] || "";
  const iguales = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  // Sin repetidas: dos veces la misma palabra en el sorteo se nota.
  const unicas: string[] = [];
  for (const p of palabras) if (!unicas.some((u) => iguales(u, p))) unicas.push(p);
  if (elegida && !unicas.some((u) => iguales(u, elegida))) unicas.push(elegida);

  d.palabras = unicas.slice(0, 14);
  d.elegida = elegida;
  for (const campo of ["titulo", "frase", "remate"]) d[campo] = limpiar(d[campo]);
  return d;
}

export type PeticionSadButTrue = {
  motor: string;
  modelo?: string | null;
  /** De qué va el sorteo; vacío = lo elige el modelo. */
  tema?: string;
  /** Humor del remate; vacío = el que le pegue a la frase. */
  tono?: Tono | "";
  idioma?: string;
  region?: string;
  modismos?: boolean;
};

/**
 * El encargo del guion. Dos cosas se repiten a propósito, porque son las que
 * decide el formato entero:
 *
 *   - las palabras del sorteo tienen que ser de la MISMA familia, si no el
 *     sorteo no parece un sorteo sino una lista de cosas sin relación;
 *   - "ligeramente desmotivadora" es un tono, no un permiso: es la verdad que
 *     da un poco de risa de lado, no el empujón al vacío.
 */
export async function generarSadButTrue(p: PeticionSadButTrue): Promise<SadButTrue> {
  if (!esMotor(p.motor)) throw new Error(`Motor desconocido: ${p.motor}`);
  const idioma = p.idioma ?? "es";
  const tono = p.tono || "";

  const prompt = [
    "Escribe el guion de un vídeo vertical de diez segundos del formato 'Sad but true'.",
    "El vídeo es así: sobre negro pasan palabras sueltas como en un sorteo, se para en una,",
    "y sobre un vídeo cualquiera aparece la frase que le toca a esa palabra. Cierra en negro con un remate.",
    p.tema ? `El sorteo va de esto: ${p.tema}.` : "Elige tú de qué va el sorteo.",
    "",
    "Cómo tiene que ser:",
    "- De 8 a 12 palabras para el sorteo, TODAS de la misma familia (cosas que se posponen, promesas que se hacen, motivos para no llamar...). Si no son de la misma familia no parece un sorteo, parece una lista.",
    "- Cada una de una a tres palabras: se leen en una décima de segundo.",
    "- 'elegida' tiene que ser EXACTAMENTE una de las de la lista.",
    "- La frase es lo que le pasa de verdad a esa palabra: concreta, cotidiana, de una o dos líneas. Ligeramente desmotivadora es que incomode y dé una media sonrisa, no que hunda a nadie.",
    "- Nada de consejos, de moralina ni de 'pero todo mejora'. Tampoco crueldad, ni insultos, ni nada dirigido a una persona real.",
    "- Nada que empuje a rendirse, a hacerse daño ni a dejar de pedir ayuda: esto es un chiste amargo sobre la vida, no un consejo sobre ella.",
    tono
      ? `- El remate cierra con una filosofía de vida de tono ${NOMBRES_TONO[tono as Tono]}.`
      : "- El remate cierra con una filosofía de vida: puede ser feliz, triste, reflexiva o desmotivadora, la que le pegue a la frase.",
    "- El remate no repite la frase ni la explica: la empuja un paso más.",
    "- Nada de emojis, de hashtags dentro del texto ni de acotaciones.",
    ortografia(idioma),
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "titulo": "título corto del vídeo",',
    '  "palabras": ["una", "otra", "otra mas"],',
    '  "elegida": "la del sorteo que gana",',
    '  "frase": "la frase ligeramente desmotivadora",',
    '  "remate": "la filosofía de vida con la que cierra",',
    `  "tono": "${tono || "feliz|triste|reflexiva|desmotivadora"}",`,
    '  "keywords": ["visual keyword in english", "another"],',
    '  "hashtags": ["sinAlmohadilla", "otro"]',
    "}",
    "Las keywords son de 3 a 5, EN INGLÉS, del ambiente del vídeo del medio: un plano cualquiera que acompañe, no una ilustración literal de la frase.",
  ]
    .filter(Boolean)
    .join("\n");

  const informe: InformeMotor = {};
  const crudo = await textoConMotor(
    p.motor,
    prompt,
    p.modelo,
    idioma,
    p.region ?? "bolivia",
    p.modismos ?? true,
    informe,
  );
  if (!crudo) throw new Error(`El motor ${informe.motor ?? p.motor} no devolvió contenido`);
  const datos = repararSadButTrue(extraerJSON(crudo)) as Record<string, unknown>;
  return SadButTrueSchema.parse({
    ...datos,
    ...(tono ? { tono } : {}),
    motorUsado: informe.motor,
    avisoMotor: informe.aviso,
  });
}

/** Los tiempos del formato, en segundos. Los de fábrica son los del guion. */
export type TiemposSadButTrue = {
  /** Toda la pantalla negra del principio: sorteo + la elegida sola. */
  sorteoSeg?: number;
  /** De esa negra, cuánto se queda la elegida quieta antes del corte. */
  retencionSeg?: number;
  /** El vídeo del medio, con la frase. */
  clipSeg?: number;
  /** La negra final con el remate, que se desvanece. */
  cierreSeg?: number;
};

/**
 * Los tiempos del formato. `clipSeg` y `cierreSeg` no son duraciones fijas
 * sino **suelos**: de ahí para arriba manda lo que se tarde en leer el texto,
 * porque no hay voz que marque el ritmo.
 */
export const TIEMPOS: Required<TiemposSadButTrue> = {
  sorteoSeg: 3,
  // Lo que se para el sorteo en el arranque de la frase antes del corte. No
  // repite nada: lo que enseña son las primeras palabras de lo que el vídeo
  // va a terminar de decir.
  retencionSeg: 0.9,
  clipSeg: 3.5,
  cierreSeg: 2,
};

/** Palabras por segundo que se leen en pantalla, y lo que cuesta enterarse. */
const LECTURA_SEG_PALABRA = 0.33;
const EN_DARSE_CUENTA = 1;
const TOPE_LECTURA = 14;

/**
 * Cuánto tiene que quedarse un texto para que dé tiempo a leerlo.
 *
 * Aquí no hay voz que marque el ritmo: si el texto se va antes de tiempo, el
 * vídeo no se entiende y no hay forma de volver atrás. Cinco segundos valen
 * para una frase corta y se quedan cortos para una de treinta palabras, así
 * que el suelo es el del formato y de ahí para arriba manda el texto.
 *
 * Son 0,33 s por palabra —unas 180 palabras por minuto, más lento que leer un
 * libro porque se lee una sola vez y con imagen moviéndose detrás— más un
 * segundo en darse cuenta de que hay algo escrito.
 */
export function tiempoDeLectura(texto: string, minimo: number): number {
  const cuantas = texto.trim().split(/\s+/).filter(Boolean).length;
  const leerlo = EN_DARSE_CUENTA + cuantas * LECTURA_SEG_PALABRA;
  return Number(Math.min(Math.max(leerlo, minimo), TOPE_LECTURA).toFixed(2));
}

/** Lo rápido y lo lento del sorteo, y cuánto frena en cada paso. */
const RAPIDO = 0.075;
const LENTO = 0.26;
const FRENO = 1.11;

/**
 * Cuánto dura cada palabra del sorteo.
 *
 * Todas iguales parece un GIF; frenando parece una ruleta que se para, que es
 * lo que hace creer que hay azar de verdad. Se llena la ventana con una
 * cadencia que crece y luego se escala para que cuadre al milisegundo con el
 * corte: la elegida tiene que entrar exactamente cuando toca.
 */
export function cadenciaSorteo(ventana: number): number[] {
  if (ventana <= RAPIDO) return [ventana];
  const pasos: number[] = [];
  let paso = RAPIDO;
  let suma = 0;
  while (suma + paso <= ventana + 1e-6) {
    pasos.push(paso);
    suma += paso;
    paso = Math.min(LENTO, paso * FRENO);
  }
  if (!pasos.length) return [ventana];
  const ajuste = ventana / suma;
  return pasos.map((p) => p * ajuste);
}

/** Baraja sin tocar el original (Fisher-Yates). */
function barajar<T>(xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Los cuatro colores del formato, y por qué cada uno.
 *
 * El sorteo va en gris sobre negro: tiene que verse que pasa algo sin que
 * nadie intente leerlo, porque a diez por segundo no da tiempo. La frase entra
 * en amarillo —el color del premio— con el contorno blanco y una **sombra
 * negra marcada**: el contorno blanco solo se sostiene sobre vídeo oscuro, y
 * los clips salen al azar. Y el remate cierra en rojo sobre negro, con el
 * contorno en rojo muy oscuro en vez del mismo rojo: a igual color la letra
 * engorda y se emborrona.
 */
const GRIS = "#8A8F98";
const AMARILLO = "#FFE500";
const BLANCO = "#FFFFFF";

/**
 * Cada texto va de **un solo color**: el relleno y el contorno, el mismo. Un
 * contorno de otro color parte la letra en dos tonos y, en cuanto el fondo se
 * parece a uno de los dos, se ve el borde antes que la palabra. Con el
 * contorno del color de la letra lo único que hace es engordarla, que sobre
 * vídeo es justo lo que hace falta.
 *
 * Lo que separa la letra del fondo pasa a ser entonces la sombra, y por eso la
 * frase la lleva marcada: es lo único que la sostiene cuando el clip que tocó
 * es claro.
 */
const unColor = (color: string, extra: Record<string, unknown> = {}) => ({
  ...ESTILO_POR_DEFECTO,
  color,
  contorno: color,
  posicion: "centro" as const,
  // Ni negrita ni el contorno gordo de siempre: con el contorno del color de
  // la letra, un borde de cuatro píxeles la engorda tanto que todo parece
  // escrito en negrita aunque no lo esté. Con dos, la letra es la que es y lo
  // que la separa del fondo sigue siendo la sombra.
  negrita: false,
  borde: 2,
  ...extra,
});

const ESTILO_SORTEO = unColor(GRIS, { tamano: 64 });
const ESTILO_ELEGIDA = unColor(AMARILLO, { tamano: 92, sombra: 6 });
const ESTILO_FRASE = unColor(BLANCO, { tamano: 76, sombra: 6 });
const ESTILO_REMATE = unColor(BLANCO, { tamano: 74, sombra: 3 });

/**
 * Del vídeo al cierre **pasando por negro**, que además es donde acaba.
 *
 * El cierre fue un rato una pantalla roja y no funcionaba: disolver el vídeo
 * dentro del rojo no se veía como un cambio de plano sino como un filtro rojo
 * encima de la ciudad, con los coches y las farolas asomando en granate a
 * media disolución. Apagando a negro, lo que se ve es que el vídeo termina, y
 * el remate aparece sobre el mismo negro del sorteo: el vídeo empieza y acaba
 * igual.
 *
 * El texto se va **antes** de que empiece su disolución, siempre: con la letra
 * clavada mientras la imagen se funde, el cambio se ve duro por suave que sea
 * la imagen, porque lo que mira el ojo es la letra.
 */
const CRUCE_VIDEO = 0.6;
const PUENTE = 1;

/**
 * El segundo de negro con el que termina todo, después de que el remate se
 * haya ido. Sin él el vídeo acaba con la letra todavía puesta, y en el bucle
 * de TikTok eso empalma con el sorteo del siguiente pase sin que se note
 * dónde acabó uno.
 */
const NEGRO_FINAL = 1;

/** Lo que el montaje añade por su cuenta a los dos tiempos de lectura. */
export const EXTRAS = CRUCE_VIDEO / 2 + PUENTE + NEGRO_FINAL;

/**
 * Con qué se para el sorteo: el arranque de la frase que ganó.
 *
 * Antes se paraba en la palabra del bombo ("la paciencia") y acto seguido el
 * vídeo enseñaba la frase entera, que empieza por esa misma palabra pero
 * escrita de otra forma. Se leía dos veces lo mismo con dos caras distintas.
 * Parando en **las primeras palabras de la frase**, lo que pasa al corte es
 * que la frase se termina: el sorteo dice "La paciencia" y el vídeo remata
 * "es infinita".
 */
export function arranqueDeFrase(frase: string, palabra: string): string {
  const ws = frase.trim().split(/\s+/).filter(Boolean);
  if (!ws.length) return palabra;
  const dos = ws.slice(0, 2).join(" ");
  // Dos palabras si caben de un vistazo; si no, con una basta.
  return dos.length <= 22 ? dos : ws[0];
}

/** El negro del sorteo y del cierre. Negro de verdad, no el gris del editor. */
const NEGRO = "#000000";

export type OpcionesPistas = TiemposSadButTrue & {
  /** La frase se escribe palabra a palabra en vez de aparecer entera. */
  revelarFrase?: boolean;
};

/**
 * Monta las dos pistas del formato: tres planos (negro, vídeo, negro) y los
 * rótulos con sus tiempos ya calculados.
 *
 * El vídeo del medio entra por un punto al azar de su propio metraje cuando da
 * de sí: dos vídeos hechos con el mismo clip no empiezan por el mismo
 * fotograma, que es lo que hace que la serie no se vea siempre igual.
 */
export function pistasDeSadButTrue(
  s: SadButTrue,
  clip: ClipInfo | null,
  o: OpcionesPistas = {},
): { video: ClipPista[]; textos: RotuloPista[] } {
  const sorteoSeg = o.sorteoSeg ?? TIEMPOS.sorteoSeg;
  // Sin tiempo puesto a mano, manda lo que se tarda en leer el texto. Los dos
  // números son **cuánto se ve el texto**; la escena dura eso más la media
  // disolución que se le come por un lado, para que leerlo no salga más corto
  // por haber suavizado el cambio.
  const leerFrase = o.clipSeg ?? tiempoDeLectura(s.frase, TIEMPOS.clipSeg);
  const leerRemate = o.cierreSeg ?? tiempoDeLectura(s.remate, TIEMPOS.cierreSeg);
  const clipSeg = Number((leerFrase + CRUCE_VIDEO / 2).toFixed(2));
  const cierreSeg = leerRemate;
  // La retención nunca se come el sorteo entero: siempre queda algo girando.
  const retencionSeg = Math.max(0, Math.min(o.retencionSeg ?? TIEMPOS.retencionSeg, sorteoSeg - RAPIDO));

  const sobra = Math.max((clip?.duracion ?? 0) - clipSeg, 0);
  const video: ClipPista[] = [
    ClipPistaSchema.parse({ id: randomUUID(), clip: null, color: NEGRO, duracion: sorteoSeg }),
    ClipPistaSchema.parse({
      id: randomUUID(),
      clip,
      color: NEGRO,
      duracion: clipSeg,
      recorte: sobra > 0.5 ? Number((Math.random() * sobra).toFixed(2)) : 0,
      efecto: efectoDeClip(clip, 1),
      // El vídeo no se disuelve en el rojo: se apaga a negro.
      transicion: "fundido",
      transicionSeg: CRUCE_VIDEO,
    }),
    // El negro de por medio y el del remate son el mismo color, pero dos
    // planos: el primero es el silencio después del vídeo y el segundo es lo
    // que dura el remate. Separados se pueden mover por su cuenta.
    ClipPistaSchema.parse({ id: randomUUID(), clip: null, color: NEGRO, duracion: PUENTE }),
    ClipPistaSchema.parse({ id: randomUUID(), clip: null, color: NEGRO, duracion: cierreSeg }),
    ClipPistaSchema.parse({ id: randomUUID(), clip: null, color: NEGRO, duracion: NEGRO_FINAL }),
  ];

  const textos: RotuloPista[] = [];

  // 1. El sorteo. Las que pasan son las demás: la elegida no se enseña hasta
  //    que gana, si no el final se ve venir.
  const arranque = arranqueDeFrase(s.frase, s.elegida);
  const ventana = Math.max(sorteoSeg - retencionSeg, 0);
  const pasos = cadenciaSorteo(ventana);
  const resto = s.palabras.filter((p) => p.toLowerCase() !== s.elegida.toLowerCase());
  const bolillero = barajar(resto.length ? resto : s.palabras);
  let t = 0;
  for (const [i, paso] of pasos.entries()) {
    textos.push(
      RotuloPistaSchema.parse({
        id: randomUUID(),
        inicio: Number(t.toFixed(3)),
        duracion: Number(paso.toFixed(3)),
        texto: bolillero[i % bolillero.length],
        estilo: ESTILO_SORTEO,
        animacion: "ninguna",
        lectura: "todo",
      }),
    );
    t += paso;
  }

  // 2. La elegida, sola y en grande hasta el corte. Solo si se pide parar: de
  //    fábrica el sorteo corre hasta el final y la revelación es el corte.
  if (sorteoSeg - ventana > 0.01) {
    textos.push(
      RotuloPistaSchema.parse({
        id: randomUUID(),
        inicio: Number(ventana.toFixed(3)),
        duracion: Number((sorteoSeg - ventana).toFixed(3)),
        texto: arranque,
        estilo: ESTILO_ELEGIDA,
        animacion: "fundido",
        lectura: "todo",
      }),
    );
  }

  // 3. La frase, que entra con el corte al vídeo. Es el premio del sorteo, así
  //    que aterriza con el zoom en vez de aparecer sin más.
  textos.push(
    RotuloPistaSchema.parse({
      id: randomUUID(),
      inicio: sorteoSeg,
      duracion: leerFrase,
      texto: s.frase,
      estilo: ESTILO_FRASE,
      // Lo sorteado sigue en amarillo dentro de la frase; lo que añade la
      // frase, en blanco. Así se ve de un vistazo qué salió y qué completa.
      resalte: { texto: arranque, color: AMARILLO },
      animacion: o.revelarFrase ? "apareciendo" : "suave",
      lectura: "todo",
    }),
  );

  // 4. El remate, ya del otro lado del negro, sobre el rojo entero. Entra y se
  //    va con el fundido largo: eso es lo que se ve desvanecerse al final.
  textos.push(
    RotuloPistaSchema.parse({
      id: randomUUID(),
      inicio: Number((sorteoSeg + clipSeg + PUENTE).toFixed(2)),
      duracion: leerRemate,
      texto: s.remate,
      estilo: ESTILO_REMATE,
      animacion: "suave",
      lectura: "todo",
    }),
  );

  return { video, textos };
}

/** Lo que se publica: la frase, el remate y las etiquetas. */
export function descripcionSadButTrue(s: SadButTrue): string {
  return [s.frase, s.remate, s.hashtags.map((h) => `#${h}`).join(" ")].filter(Boolean).join("\n\n");
}
