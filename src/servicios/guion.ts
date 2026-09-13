import { z } from "zod";
import { env } from "../env.js";
import { leerJSON } from "../util/http.js";
import {
  resolverCategoria,
  buscarCategoria,
  fuentesAlAzar,
  type Categoria,
  type Subcategoria,
} from "./categorias.js";

/**
 * Nombres de modelo por defecto. Los proveedores los renuevan a menudo, asi
 * que se configuran en el entorno (GROQ_MODELO, GEMINI_MODELO, ...) y se
 * pueden afinar por serie o por historia sin tocar el codigo.
 */
export const MODELOS: Record<Motor, string> = {
  groq: env.GROQ_MODELO,
  openai: env.OPENAI_MODELO,
  gemini: env.GEMINI_MODELO,
  claude: env.ANTHROPIC_MODELO,
};

export const MOTORES = ["groq", "openai", "gemini", "claude"] as const;
export type Motor = (typeof MOTORES)[number];

export const esMotor = (v: string): v is Motor => (MOTORES as readonly string[]).includes(v);

export const REGIONES = ["bolivia", "latam", "eeuu"] as const;
export type Region = (typeof REGIONES)[number];

/** Cómo debe sonar el texto según la región y si se piden modismos. */
export function descripcionRegion(region: string, modismos: boolean, idioma: string) {
  if (idioma === "en" || region === "eeuu") {
    return modismos
      ? "inglés de Estados Unidos, natural y coloquial, con expresiones propias del país"
      : "inglés de Estados Unidos, claro y neutro";
  }
  if (region === "bolivia") {
    return modismos
      ? "español de Bolivia: usa con naturalidad modismos y giros bolivianos (sin exagerar ni caricaturizar), " +
        "voseo o tuteo según suene natural en Bolivia, y referencias cotidianas del país"
      : "español latinoamericano neutro, sin modismos regionales";
  }
  return modismos
    ? "español latinoamericano, cercano y coloquial, con expresiones comunes en toda la región"
    : "español latinoamericano neutro, sin modismos regionales";
}

/**
 * Regla de ortografía explícita. Un prompt escrito sin tildes hace que el
 * modelo escriba sin tildes; por eso este texto lleva todas las suyas.
 */
export const ORTOGRAFIA =
  "Escribe con ortografía impecable: todas las tildes (á, é, í, ó, ú), la ñ, la diéresis cuando toque, " +
  "los signos de apertura ¿ y ¡ además de los de cierre, comas, puntos y mayúsculas correctas. " +
  "Nunca omitas tildes ni escribas 'n' por 'ñ'.";

const sistema = (idioma: string, region = "latam", modismos = true) =>
  `Eres guionista de vídeos verticales cortos. Escribes en ${descripcionRegion(region, modismos, idioma)}. ` +
  `${ORTOGRAFIA} ` +
  "Respondes únicamente con un objeto JSON válido, sin texto alrededor y sin bloques de código.";

async function pedirJSON(url: string, init: RequestInit, servicio: string) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const data = await leerJSON(res);
  if (!res.ok) {
    throw new Error(`${servicio} respondio ${res.status}: ${data?.error?.message ?? "sin detalle"}`);
  }
  return data;
}

/** Los modelos a veces envuelven el JSON en ```json ... ```; esto lo desenvuelve. */
export function extraerJSON(texto: string): unknown {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio === -1 || fin === -1) throw new Error("El modelo no devolvio un objeto JSON");
  return JSON.parse(limpio.slice(inicio, fin + 1));
}

export async function textoConGroq(prompt: string, modelo = MODELOS.groq, idioma = "es", region = "latam", modismos = true) {
  if (!env.GROQ_API_KEY) throw new Error("Falta GROQ_API_KEY");
  const data = await pedirJSON(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: "system", content: sistema(idioma, region, modismos) },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    },
    "Groq",
  );
  return data.choices?.[0]?.message?.content as string;
}

export async function textoConOpenAI(prompt: string, modelo = MODELOS.openai, idioma = "es", region = "latam", modismos = true) {
  if (!env.OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY");
  const data = await pedirJSON(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelo,
        messages: [
          { role: "system", content: sistema(idioma, region, modismos) },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    },
    "OpenAI",
  );
  return data.choices?.[0]?.message?.content as string;
}

export async function textoConGemini(prompt: string, modelo = MODELOS.gemini, idioma = "es", region = "latam", modismos = true) {
  if (!env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  const data = await pedirJSON(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema(idioma, region, modismos) }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
    "Gemini",
  );
  const partes = data.candidates?.[0]?.content?.parts ?? [];
  return partes.map((p: { text?: string }) => p.text ?? "").join("") as string;
}

export async function textoConClaude(prompt: string, modelo = MODELOS.claude, idioma = "es", region = "latam", modismos = true) {
  if (!env.ANTHROPIC_API_KEY) throw new Error("Falta ANTHROPIC_API_KEY");
  const data = await pedirJSON(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: modelo,
        max_tokens: 8000,
        system: sistema(idioma, region, modismos),
        messages: [{ role: "user", content: prompt }],
      }),
    },
    "Claude",
  );
  if (data.stop_reason === "refusal") {
    throw new Error(`Claude rechazo la peticion: ${data.stop_details?.explanation ?? "sin detalle"}`);
  }
  const bloques: { type: string; text?: string }[] = data.content ?? [];
  return bloques
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("");
}

/** El primer motor con clave configurada, para tareas pequenas sin elegir. */
export function motorDisponible(): Motor | null {
  const orden: [Motor, string | undefined][] = [
    ["groq", env.GROQ_API_KEY],
    ["gemini", env.GEMINI_API_KEY],
    ["openai", env.OPENAI_API_KEY],
    ["claude", env.ANTHROPIC_API_KEY],
  ];
  return orden.find(([, clave]) => clave)?.[0] ?? null;
}

const STOP = new Set(
  ("de la el los las un una y o que en a por para con sin es son se su sus al del lo le " +
   "the a an of to in on and or is are was were for with at by from this that it as be").split(" "),
);

/** Sin motor a mano: palabras largas del propio texto, mejor que nada. */
function keywordsHeuristicas(texto: string): string[] {
  const ws = texto.toLowerCase().replace(/[^\p{L}\s]/gu, " ").split(/\s+/)
    .filter((w) => w.length >= 5 && !STOP.has(w));
  return [...new Set(ws)].slice(0, 2).length ? [...new Set(ws)].slice(0, 2) : ["cinematic"];
}

const KeywordsSchema = z.object({
  keywords: z.array(z.array(z.string().min(1).max(40)).min(1).max(3)),
});

/**
 * Palabras clave visuales en ingles para buscar un clip parecido a cada texto.
 * Una sola llamada para todas las escenas; sin motor cae en la heuristica.
 */
export async function generarKeywords(textos: string[], idioma = "es", motor?: string | null) {
  const elegido = (motor && esMotor(motor) ? motor : null) ?? motorDisponible();
  if (!elegido || !textos.length) return textos.map(keywordsHeuristicas);

  const prompt = [
    "Para cada uno de estos textos de un vídeo vertical, da de 1 a 3 palabras clave EN INGLÉS,",
    "concretas y visuales, para buscar un video de archivo que se parezca a lo que describe",
    "(ejemplos: 'rainy window', 'sunrise mountains', 'person walking city night').",
    "Devuelve exactamente este JSON, con un array por texto y en el mismo orden:",
    '{ "keywords": [["palabra", "otra"], ["palabra"]] }',
    "",
    ...textos.map((t, i) => `${i + 1}. ${t.replace(/\s+/g, " ").slice(0, 300)}`),
  ].join("\n");

  try {
    const crudo = await (elegido === "claude"
      ? textoConClaude(prompt, MODELOS.claude, idioma)
      : elegido === "openai"
        ? textoConOpenAI(prompt, MODELOS.openai, idioma)
        : elegido === "gemini"
          ? textoConGemini(prompt, MODELOS.gemini, idioma)
          : textoConGroq(prompt, MODELOS.groq, idioma));
    const { keywords } = KeywordsSchema.parse(extraerJSON(crudo));
    // Si el modelo devolvio menos filas, el resto va por heuristica.
    return textos.map((t, i) => keywords[i] ?? keywordsHeuristicas(t));
  } catch {
    return textos.map(keywordsHeuristicas);
  }
}

/** Llama al motor elegido con el mismo sistema y devuelve el texto crudo. */
export async function textoConMotor(
  motor: Motor,
  prompt: string,
  modelo?: string | null,
  idioma = "es",
  region = "bolivia",
  modismos = true,
) {
  const m = modelo?.trim() || MODELOS[motor];
  return motor === "claude"
    ? textoConClaude(prompt, m, idioma, region, modismos)
    : motor === "openai"
      ? textoConOpenAI(prompt, m, idioma, region, modismos)
      : motor === "gemini"
        ? textoConGemini(prompt, m, idioma, region, modismos)
        : textoConGroq(prompt, m, idioma, region, modismos);
}

export type EstiloNarracion = "plano" | "expresivo";

/**
 * Convierte un guion (o un texto) en narracion corrida, bien puntuada y con
 * signos de exclamacion e interrogacion donde toca. En modo expresivo anade
 * indicaciones breves entre corchetes que Gemini TTS interpreta como tono;
 * los motores locales las quitan antes de leer.
 */
export async function escribirNarracion(
  fuente: string,
  estilo: EstiloNarracion,
  idioma = "es",
  motor?: string | null,
  region = "bolivia",
  modismos = true,
): Promise<string> {
  const elegido = (motor && esMotor(motor) ? motor : null) ?? motorDisponible();
  if (!elegido) throw new Error("No hay ningun motor de IA configurado para redactar la narracion");

  const prompt = [
    "Reescribe el siguiente contenido como una NARRACIÓN CORRIDA para leer en voz alta en un vídeo vertical.",
    "Un solo texto seguido, en párrafos cortos, sin títulos, sin listas, sin comillas de diálogo.",
    "Puntuación cuidada: frases completas terminadas en punto, comas donde se respira,",
    "signos de exclamación e interrogación de apertura y cierre donde el tono lo pida.",
    ORTOGRAFIA,
    `Escribe en ${descripcionRegion(region, modismos, idioma)}.`,
    "Conserva el gancho como primera frase, corta y fuerte. No inventes datos nuevos.",
    "No pases de 850 palabras: el vídeo tiene un tope de 350 segundos.",
    estilo === "expresivo"
      ? "Además, añade indicaciones de tono ENTRE CORCHETES, muy breves y solo cuando ayuden, por ejemplo " +
        "[pausa], [susurrando], [con énfasis], [más lento], [alegre], [serio]. Nunca más de una por frase."
      : "Sin indicaciones de tono ni marcas: texto plano limpio.",
    'Devuelve exactamente este JSON: { "narracion": "..." }',
    "",
    "CONTENIDO:",
    fuente.slice(0, 6000),
  ].join("\n");

  const crudo = await (elegido === "claude"
    ? textoConClaude(prompt, MODELOS.claude, idioma, region, modismos)
    : elegido === "openai"
      ? textoConOpenAI(prompt, MODELOS.openai, idioma, region, modismos)
      : elegido === "gemini"
        ? textoConGemini(prompt, MODELOS.gemini, idioma, region, modismos)
        : textoConGroq(prompt, MODELOS.groq, idioma, region, modismos));
  const { narracion } = z.object({ narracion: z.string().min(20).max(20_000) }).parse(extraerJSON(crudo));
  return narracion.replace(/\r/g, "").replace(/[ \t]+/g, " ").trim();
}

/** El guion en prosa, tal cual, para cuando no se quiere pasar por la IA. */
export function guionComoNarracion(guion: Guion): string {
  return [guion.gancho, ...guion.escenas.map((e) => e.texto)].join("\n\n");
}

export const GuionSchema = z.object({
  titulo: z.string().min(1).max(120),
  /** Primera frase del video: abre un bucle y decide si se quedan o no. */
  gancho: z.string().min(1).max(200),
  escenas: z
    .array(
      z.object({
        texto: z.string().min(1).max(400),
        keywords: z.array(z.string().max(40)).min(1).max(3),
      }),
    )
    .min(3)
    .max(60),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
  /**
   * Ganchos VIRALES para la descripción: los que se leen en el texto de la
   * publicación, no los que se narran. El primero encabeza la descripción y
   * los otros quedan como alternativas para probar cuál rinde.
   */
  ganchos: z.array(z.string().min(1).max(150)).max(4).default([]),
  /** Categoría y subcategoría con las que se planteó; vacías = tema libre. */
  categoria: z.string().max(40).nullable().default(null),
  subcategoria: z.string().max(40).nullable().default(null),
  /** Título y lineamientos generados antes de escribir, si se pasó por ese paso. */
  premisa: z.lazy(() => PremisaSchema).nullable().default(null),
  /** Criterios visuales generales EN INGLÉS para buscar clips de toda la historia. */
  keywords: z.array(z.string().max(40)).max(8).default([]),
});

export type Guion = z.infer<typeof GuionSchema>;

/**
 * El planteamiento previo: antes de escribir la historia se decide el título,
 * los lineamientos y el giro, y de ahí salen los criterios de búsqueda de
 * clips. Así el guion no improvisa y los vídeos pegan con el género.
 */
export const PremisaSchema = z.object({
  categoria: z.string().max(40),
  subcategoria: z.string().max(40),
  titulo: z.string().min(1).max(120),
  /** Reglas que la historia debe cumplir: 3 a 6 frases cortas. */
  lineamientos: z.array(z.string().min(1).max(200)).min(1).max(8),
  personajes: z.array(z.string().min(1).max(120)).max(5).default([]),
  /** El giro o remate que se guarda para el final. */
  giro: z.string().max(300).default(""),
  /** Solo en el área de ideas: la obra, el autor o la corriente de donde sale. */
  fuente: z.string().max(200).default(""),
  /** Solo en el área de ideas: la idea central, en una frase. */
  idea: z.string().max(400).default(""),
  /** Criterios EN INGLÉS para buscar clips del ambiente general. */
  keywords: z.array(z.string().min(1).max(40)).min(1).max(8),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
});

export type Premisa = z.infer<typeof PremisaSchema>;

export type PeticionPremisa = {
  motor: string;
  modelo?: string | null;
  /** Id de categoría, "aleatoria" o vacío (entonces también se elige al azar). */
  categoria?: string | null;
  subcategoria?: string | null;
  tema?: string;
  duracion?: number;
  idioma?: string;
  region?: string;
  modismos?: boolean;
  evitar?: (string | null)[];
};

/**
 * Genera al azar (o dentro de la categoría pedida) el título y los
 * lineamientos de una historia, sin escribirla todavía.
 */
export async function generarPremisa(p: PeticionPremisa): Promise<Premisa> {
  if (!esMotor(p.motor)) throw new Error(`Motor desconocido: ${p.motor}`);
  const elegida = resolverCategoria(p.categoria || "aleatoria", p.subcategoria);
  if (!elegida) throw new Error("No se pudo elegir una categoría");
  const { categoria, subcategoria } = elegida;
  const idioma = p.idioma ?? "es";
  const titulosPrevios = (p.evitar ?? []).filter(Boolean).slice(0, 20) as string[];

  const visuales = `Las keywords son de 3 a 6, EN INGLÉS, concretas y visuales, que describan el ambiente de todo el vídeo (por ejemplo: ${categoria.visual
    .slice(0, 3)
    .map((v) => `'${v}'`)
    .join(", ")}).`;
  const reglas = (categoria.reglas ?? []).map((r) => `- ${r}`);

  // En el área de ideas no se inventa una trama: se elige de quién es la idea,
  // cuál es y con qué ejemplo se baja a tierra.
  const prompt = (
    categoria.area === "ideas"
      ? [
          "Antes de escribir un guion de vídeo vertical de IDEAS, PLANTÉALO. No escribas el guion todavía.",
          `Área: ideas y pensamiento. Categoría: ${categoria.nombre}. Línea: ${subcategoria.nombre} (${subcategoria.pista}).`,
          `Tono: ${categoria.tono}`,
          reglas.length ? ["Reglas de esta categoría, obligatorias:", ...reglas].join("\n") : "",
          p.tema
            ? `Tema o punto de partida que hay que respetar: ${p.tema}.`
            : `Elige una idea concreta. Puedes partir de una de estas fuentes o de otra equivalente que conozcas bien: ${fuentesAlAzar(categoria).join(" | ")}.`,
          p.duracion ? `El vídeo durará unos ${p.duracion} segundos: la idea tiene que caber ahí, con su ejemplo.` : "",
          "No inventes obras, autores, citas ni datos. Si dudas de una cita, no la uses: explica la idea con tus palabras.",
          titulosPrevios.length ? `Evita parecerse a estos vídeos ya hechos: ${titulosPrevios.join(" | ")}.` : "",
          ORTOGRAFIA,
          "",
          "Devuelve exactamente este JSON:",
          "{",
          '  "titulo": "título corto y concreto, de 8 palabras como máximo",',
          '  "fuente": "obra, autor, corriente o caso de donde sale la idea",',
          '  "idea": "la idea central en una sola frase, con tus palabras",',
          '  "lineamientos": ["regla 1 que el vídeo debe cumplir", "regla 2", "regla 3", "regla 4"],',
          '  "giro": "la frase final que deja pensando, la que no se adelanta",',
          '  "keywords": ["visual keyword in english", "another", "another"],',
          '  "hashtags": ["sinAlmohadilla", "otro"]',
          "}",
          "Los lineamientos son de 3 a 6, frases cortas: qué problema cotidiano se plantea, qué ejemplo concreto se usa, " +
            "qué objeción seria se reconoce y qué NO debe hacer el vídeo.",
          visuales,
        ]
      : [
          "Antes de escribir un guion de vídeo vertical, PLANTEA la historia. No la escribas todavía.",
          `Categoría: ${categoria.nombre}. Subcategoría: ${subcategoria.nombre} (${subcategoria.pista}).`,
          `Tono del género: ${categoria.tono}`,
          reglas.length ? ["Reglas de esta categoría, obligatorias:", ...reglas].join("\n") : "",
          p.tema ? `Tema o punto de partida que hay que respetar: ${p.tema}.` : "Inventa una historia original y concreta, con un giro que no se vea venir.",
          p.duracion ? `El vídeo durará unos ${p.duracion} segundos: la historia debe caber en ese tiempo.` : "",
          "Nada de personas reales identificables ni de marcas; los personajes son inventados.",
          titulosPrevios.length ? `Evita parecerse a estas historias ya hechas: ${titulosPrevios.join(" | ")}.` : "",
          ORTOGRAFIA,
          "",
          "Devuelve exactamente este JSON:",
          "{",
          '  "titulo": "título corto y concreto, de 8 palabras como máximo",',
          '  "lineamientos": ["regla 1 que la historia debe cumplir", "regla 2", "regla 3", "regla 4"],',
          '  "personajes": ["nombre y un rasgo", "otro"],',
          '  "giro": "el remate o giro que se guarda para el final, en una frase",',
          '  "keywords": ["visual keyword in english", "another", "another"],',
          '  "hashtags": ["sinAlmohadilla", "otro"]',
          "}",
          "Los lineamientos son de 3 a 6, cada uno una frase corta (dónde pasa, quién, qué está en juego, qué NO debe pasar).",
          visuales,
        ]
  )
    .filter(Boolean)
    .join("\n");

  const crudo = await textoConMotor(p.motor, prompt, p.modelo, idioma, p.region ?? "bolivia", p.modismos ?? true);
  if (!crudo) throw new Error(`El motor ${p.motor} no devolvió contenido`);
  const datos = extraerJSON(crudo) as Record<string, unknown>;
  return PremisaSchema.parse({
    ...datos,
    categoria: categoria.id,
    subcategoria: subcategoria.id,
    hashtags: [...new Set([...(Array.isArray(datos.hashtags) ? datos.hashtags : []), ...categoria.hashtags])].slice(0, 8),
  });
}

/**
 * Miniserie: una historia larga repartida en capítulos que se planean de
 * golpe. No es lo mismo que continuar una historia (`continuaDe`), donde cada
 * parte se improvisa sobre la anterior: aquí se sabe desde el principio cuántos
 * capítulos hay, qué pasa en cada uno y dónde corta cada final.
 */
export const CapituloSchema = z.object({
  numero: z.number().int().min(1).max(12),
  titulo: z.string().min(1).max(120),
  /** Qué pasa en este capítulo, en dos o tres frases. */
  resumen: z.string().min(1).max(600),
  /** Con qué corta; el último no lleva, porque cierra. */
  cliffhanger: z.string().max(300).default(""),
});

export type Capitulo = z.infer<typeof CapituloSchema>;

export const MiniserieSchema = z.object({
  categoria: z.string().max(40),
  subcategoria: z.string().max(40),
  titulo: z.string().min(1).max(120),
  /** De qué va la miniserie entera, en dos o tres frases. */
  sinopsis: z.string().min(1).max(900),
  personajes: z.array(z.string().min(1).max(120)).max(6).default([]),
  capitulos: z.array(CapituloSchema).min(2).max(12),
  keywords: z.array(z.string().min(1).max(40)).min(1).max(8),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
});

export type Miniserie = z.infer<typeof MiniserieSchema>;

export type PeticionMiniserie = PeticionPremisa & {
  /** Cuántos capítulos; entre 2 y 12. */
  capitulos?: number;
};

/** Contexto de un capítulo concreto al escribir su guion. */
export type ContextoCapitulo = {
  numero: number;
  total: number;
  tituloSerie: string;
  sinopsis: string;
  titulo: string;
  resumen: string;
  cliffhanger: string;
  /** Con qué cortó el capítulo anterior; vacío en el primero. */
  anterior?: string;
  personajes?: string[];
};

/**
 * Planea la miniserie entera —título, sinopsis, personajes y qué pasa en cada
 * capítulo— sin escribir ningún guion. Después, cada capítulo se escribe por
 * separado con `generarGuion({ capitulo })`.
 */
export async function generarMiniserie(p: PeticionMiniserie): Promise<Miniserie> {
  if (!esMotor(p.motor)) throw new Error(`Motor desconocido: ${p.motor}`);
  const elegida = resolverCategoria(p.categoria || "aleatoria", p.subcategoria);
  if (!elegida) throw new Error("No se pudo elegir una categoría");
  const { categoria, subcategoria } = elegida;
  const cuantos = Math.min(12, Math.max(2, Math.round(p.capitulos ?? 4)));
  const idioma = p.idioma ?? "es";
  const ideas = categoria.area === "ideas";
  const reglas = (categoria.reglas ?? []).map((r) => `- ${r}`);

  const prompt = [
    `PLANEA una miniserie de ${cuantos} capítulos para vídeo vertical. No escribas todavía ningún guion.`,
    `Categoría: ${categoria.nombre} › ${subcategoria.nombre} (${subcategoria.pista}).`,
    `Tono: ${categoria.tono}`,
    reglas.length ? ["Reglas de esta categoría, obligatorias:", ...reglas].join("\n") : "",
    p.tema ? `Tema o punto de partida que hay que respetar: ${p.tema}.` : "",
    ideas
      ? `Cada capítulo es una idea que se sostiene sola, y juntos cuentan algo más grande. Puedes partir de: ${fuentesAlAzar(categoria).join(" | ")}.`
      : `Es UNA historia repartida en capítulos, no ${cuantos} historias sueltas: los personajes y el conflicto son los mismos.`,
    p.duracion ? `Cada capítulo dura unos ${p.duracion} segundos.` : "",
    ideas ? "" : "Nada de personas reales identificables ni de marcas; los personajes son inventados.",
    "Cada capítulo (menos el último) termina en un corte que obliga a ver el siguiente; el último cierra la historia del todo.",
    ORTOGRAFIA,
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "titulo": "título de la miniserie, corto",',
    '  "sinopsis": "de qué va todo, en dos o tres frases",',
    '  "personajes": ["nombre y un rasgo", "otro"],',
    '  "capitulos": [',
    `    { "numero": 1, "titulo": "título del capítulo", "resumen": "qué pasa en él, dos o tres frases", "cliffhanger": "con qué corta" }`,
    "  ],",
    '  "keywords": ["visual keyword in english", "another"],',
    '  "hashtags": ["sinAlmohadilla", "otro"]',
    "}",
    `Tienen que ser exactamente ${cuantos} capítulos, numerados del 1 al ${cuantos}, y el último con "cliffhanger" vacío.`,
    `Las keywords son de 3 a 6, EN INGLÉS, del ambiente de toda la miniserie (por ejemplo: ${categoria.visual
      .slice(0, 3)
      .map((v) => `'${v}'`)
      .join(", ")}).`,
  ]
    .filter(Boolean)
    .join("\n");

  const crudo = await textoConMotor(p.motor, prompt, p.modelo, idioma, p.region ?? "bolivia", p.modismos ?? true);
  if (!crudo) throw new Error(`El motor ${p.motor} no devolvió contenido`);
  const datos = extraerJSON(crudo) as Record<string, unknown>;
  const plan = MiniserieSchema.parse({
    ...datos,
    categoria: categoria.id,
    subcategoria: subcategoria.id,
    hashtags: [...new Set([...(Array.isArray(datos.hashtags) ? datos.hashtags : []), ...categoria.hashtags])].slice(0, 8),
  });
  // Los modelos se saltan la numeración y el orden; se reordena aquí.
  return {
    ...plan,
    capitulos: plan.capitulos
      .slice(0, cuantos)
      .map((c, i) => ({ ...c, numero: i + 1, cliffhanger: i === plan.capitulos.length - 1 ? "" : c.cliffhanger })),
  };
}

/** El contexto que necesita el guion de un capítulo, sacado del plan. */
export function contextoDeCapitulo(plan: Miniserie, numero: number): ContextoCapitulo {
  const capitulo = plan.capitulos.find((c) => c.numero === numero) ?? plan.capitulos[0];
  const anterior = plan.capitulos.find((c) => c.numero === capitulo.numero - 1);
  return {
    numero: capitulo.numero,
    total: plan.capitulos.length,
    tituloSerie: plan.titulo,
    sinopsis: plan.sinopsis,
    titulo: capitulo.titulo,
    resumen: capitulo.resumen,
    cliffhanger: capitulo.cliffhanger,
    anterior: anterior ? anterior.cliffhanger || anterior.resumen : "",
    personajes: plan.personajes,
  };
}

/** Criterios de búsqueda de clips de una historia: los suyos y los de su categoría. */
export function criteriosVisuales(guion: Pick<Guion, "keywords" | "categoria" | "premisa">): string[] {
  const cat = buscarCategoria(guion.categoria);
  return [...new Set([...(guion.keywords ?? []), ...(guion.premisa?.keywords ?? []), ...(cat?.visual ?? [])])].slice(0, 10);
}

export type PeticionGuion = {
  motor: string;
  /** Modelo concreto; si falta se usa el del entorno para ese motor. */
  modelo?: string | null;
  tipo: string;
  tema?: string;
  duracion: number;
  idioma?: string;
  /** bolivia (por defecto), latam o eeuu. */
  region?: string;
  /** Modismos propios de la región; false = neutro. */
  modismos?: boolean;
  /** false cuando el texto se lee en pantalla en vez de narrarse. */
  narrado?: boolean;
  /** Para continuar una historia: parte anterior y número de esta parte. */
  continuaDe?: { parte: number; resumen: string; ultimaFrase: string } | null;
  /** Gancho ya probado que hay que reutilizar tal cual. */
  ganchoFijo?: string | null;
  evitar?: (string | null)[];
  /** Categoría ("aleatoria" = una al azar) y subcategoría; vacías = tema libre. */
  categoria?: string | null;
  subcategoria?: string | null;
  /** Planteamiento ya hecho (título, lineamientos, giro); si falta y hay categoría, se genera. */
  premisa?: Premisa | null;
  /** Capítulo de una miniserie ya planeada; manda sobre el planteamiento suelto. */
  capitulo?: ContextoCapitulo | null;
};

function construirPrompt(
  { tipo, tema, duracion, ganchoFijo, narrado = true, continuaDe, capitulo, evitar = [] }: PeticionGuion,
  plan?: { categoria: Categoria; subcategoria: Subcategoria; premisa: Premisa | null } | null,
) {
  // ~2,6 palabras por segundo de narración pausada; escenas de unos 8 s.
  const palabras = Math.round(duracion * 2.6);
  const escenas = Math.max(4, Math.min(45, Math.round(duracion / 8)));
  const titulosPrevios = evitar.filter(Boolean).slice(0, 20) as string[];

  // Un vídeo de ideas no se escribe como un cuento: no hay trama que inventar,
  // hay una idea de alguien que se explica, se ejemplifica y se discute.
  const ideas = plan?.categoria.area === "ideas";

  return [
    capitulo
      ? `Escribe el CAPÍTULO ${capitulo.numero} de ${capitulo.total} de la miniserie "${capitulo.tituloSerie}", para un vídeo vertical.`
      : continuaDe
        ? `Escribe la PARTE ${continuaDe.parte + 1} de una historia por entregas para un vídeo vertical.`
        : ideas
          ? "Escribe el guion de un vídeo vertical de IDEAS para redes sociales: una idea grande explicada en poco tiempo, " +
            "sin jerga y sin sonar a clase."
          : `Escribe el guion de un vídeo vertical de ${tipo.toLowerCase()} para redes sociales.`,
    capitulo
      ? [
          `De qué va la miniserie: ${capitulo.sinopsis}`,
          capitulo.personajes?.length ? `Personajes: ${capitulo.personajes.join("; ")}.` : "",
          `Título de este capítulo: "${capitulo.titulo}". Úsalo tal cual.`,
          `Lo que pasa en este capítulo: ${capitulo.resumen}`,
          capitulo.numero > 1 && capitulo.anterior
            ? `El capítulo anterior cortó así: ${capitulo.anterior}. Recuérdalo en UNA frase al principio y sigue desde ahí, sin repetir lo ya contado.`
            : "Es el primer capítulo: presenta a quien haga falta y engancha desde la primera frase.",
          capitulo.numero < capitulo.total
            ? `Termina justo en este corte, sin resolverlo: ${capitulo.cliffhanger || "algo que obligue a ver el capítulo siguiente"}.`
            : "Es el último capítulo: cierra la historia entera. Nada queda abierto y no se anuncia una continuación.",
          "No cuentes lo que pasa en capítulos posteriores.",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    continuaDe
      ? `Lo que pasó hasta ahora: ${continuaDe.resumen}\nÚltima frase de la parte anterior: "${continuaDe.ultimaFrase}".\n` +
        "Continúa EXACTAMENTE desde ahí, sin repetir lo contado, y termina con un cierre que deje ganas de la siguiente parte."
      : "",
    plan
      ? `Categoría: ${plan.categoria.nombre} › ${plan.subcategoria.nombre} (${plan.subcategoria.pista}). Tono: ${plan.categoria.tono}`
      : "",
    plan?.categoria.reglas?.length
      ? ["Reglas de esta categoría, obligatorias:", ...plan.categoria.reglas.map((r) => `- ${r}`)].join("\n")
      : "",
    ideas
      ? [
          "Estructura del vídeo:",
          "  1. Gancho: la pregunta incómoda o la afirmación que descoloca.",
          "  2. El problema, con un ejemplo cotidiano y concreto (nada de abstracciones).",
          "  3. La idea y de quién es: nómbralo con su obra o su corriente.",
          "  4. La objeción o el contraejemplo más serio, reconocido sin trampa.",
          "  5. Qué cambia si te la tomas en serio, en algo que pase mañana.",
          "  6. Cierre memorable, sin moraleja de póster.",
          "Como mucho UNA cita textual, breve, entre comillas y con su autor; el resto con tus palabras. No inventes citas.",
        ].join("\n")
      : "",
    plan?.premisa
      ? [
          `Título ya decidido: "${plan.premisa.titulo}". Úsalo tal cual.`,
          ideas && plan.premisa.fuente ? `La idea sale de: ${plan.premisa.fuente}. Nómbralo en el vídeo.` : "",
          ideas && plan.premisa.idea ? `Idea central que hay que sostener: ${plan.premisa.idea}` : "",
          ideas ? "Lineamientos que el vídeo DEBE cumplir:" : "Lineamientos que la historia DEBE cumplir:",
          ...plan.premisa.lineamientos.map((l, i) => `  ${i + 1}. ${l}`),
          !ideas && plan.premisa.personajes.length ? `Personajes: ${plan.premisa.personajes.join("; ")}.` : "",
          plan.premisa.giro
            ? ideas
              ? `Frase de cierre hacia la que va todo (no la adelantes): ${plan.premisa.giro}`
              : `Giro o remate para el final (no lo adelantes): ${plan.premisa.giro}`
            : "",
        ].filter(Boolean).join("\n")
      : "",
    tema ? `Tema: ${tema}.` : continuaDe || plan ? "" : "Tema: elige uno libremente, que sea universal y emotivo.",
    `Duración objetivo: ${duracion} segundos (unas ${palabras} palabras en total).`,
    `Divide el guion en ${escenas} escenas de una a tres frases cada una.`,
    ganchoFijo
      ? `Usa EXACTAMENTE este gancho, sin cambiar ni una palabra: "${ganchoFijo}"`
      : "Escribe un gancho de una sola frase, de 12 palabras como maximo, que se lea en menos de 3 segundos. " +
        "Debe abrir un bucle (una pregunta sin responder, una afirmacion inesperada o una escena a medias). " +
        "Prohibido saludar, presentarse o decir 'en este video'.",
    continuaDe
      ? "El gancho de esta parte debe recordar en una frase dónde quedó la historia y prometer lo que viene."
      : "El gancho va aparte y además encabeza el vídeo; las escenas continúan desde él.",
    ideas
      ? "La última escena cierra con la idea que se queda; nada de pedir likes, seguidores ni 'comenta qué opinas'."
      : "La ultima escena debe cerrar con una idea memorable, sin pedir likes ni seguidores.",
    narrado
      ? "No uses emojis, comillas tipográficas ni acotaciones de cámara dentro del texto narrado."
      : "El texto NO se narra: se lee en pantalla como subtítulo. Frases cortas, " +
        "como mucho 14 palabras por escena, sin emojis ni acotaciones.",
    ORTOGRAFIA,
    titulosPrevios.length
      ? `Evita repetir estos títulos ya publicados: ${titulosPrevios.join(" | ")}.`
      : "",
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "titulo": "título corto y concreto",',
    '  "gancho": "frase de enganche",',
    '  "escenas": [',
    '    { "texto": "frase narrada", "keywords": ["palabra en inglés para buscar vídeo de stock", "otra"] }',
    "  ],",
    '  "ganchos": ["gancho viral para la descripción", "otro distinto", "otro más"],',
    '  "hashtags": ["sinAlmohadilla", "otro"]',
    "}",
    "Los ganchos NO se narran: son el texto con el que se publica el vídeo. Tres, de 90 caracteres como máximo, " +
      "cada uno con un ángulo distinto (una pregunta que pica, un dato que descoloca, una promesa concreta). " +
      "Sin emojis, sin hashtags dentro, sin pedir like ni seguir, sin 'mira hasta el final'.",
    "Las keywords deben estar en inglés, ser concretas y visuales (por ejemplo: 'rainy window', 'sunrise mountains').",
    plan
      ? `Las keywords de cada escena deben ir con el ambiente del género: ${[...new Set([...(plan.premisa?.keywords ?? []), ...plan.categoria.visual])].slice(0, 6).join(", ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generarGuion(peticion: PeticionGuion): Promise<Guion> {
  if (!esMotor(peticion.motor)) throw new Error(`Motor desconocido: ${peticion.motor}`);
  const motor = peticion.motor;
  const modelo = peticion.modelo?.trim() || MODELOS[motor];
  const idioma = peticion.idioma ?? "es";
  const region = peticion.region ?? "bolivia";
  const modismos = peticion.modismos ?? true;

  // Planteamiento previo: con categoría (o al azar) primero se decide título,
  // lineamientos y giro, y solo después se escribe. Una continuación hereda
  // el planteamiento de la parte anterior y no vuelve a plantear.
  let premisa = peticion.premisa ?? null;
  if (!premisa && peticion.categoria && !peticion.continuaDe && !peticion.capitulo) {
    premisa = await generarPremisa({
      motor, modelo, categoria: peticion.categoria, subcategoria: peticion.subcategoria,
      tema: peticion.tema, duracion: peticion.duracion, idioma, region, modismos, evitar: peticion.evitar,
    });
  }
  const elegida = resolverCategoria(premisa?.categoria ?? peticion.categoria, premisa?.subcategoria ?? peticion.subcategoria);
  const plan = elegida ? { ...elegida, premisa } : null;

  const prompt = construirPrompt(peticion, plan);
  const crudo = await textoConMotor(motor, prompt, modelo, idioma, region, modismos);
  if (!crudo) throw new Error(`El motor ${motor} (${modelo}) no devolvio contenido`);

  const guion = GuionSchema.parse(extraerJSON(crudo));
  if (peticion.capitulo) guion.titulo = peticion.capitulo.titulo;
  else if (premisa) guion.titulo = premisa.titulo;
  return {
    ...guion,
    categoria: plan?.categoria.id ?? null,
    subcategoria: plan?.subcategoria.id ?? null,
    premisa,
    keywords: [...new Set([...(premisa?.keywords ?? []), ...(plan?.categoria.visual ?? [])])].slice(0, 8),
    hashtags: [...new Set([...guion.hashtags, ...(premisa?.hashtags ?? []), ...(plan?.categoria.hashtags ?? [])])].slice(0, 8),
  };
}

/** Resumen breve y última frase de un guion, para pedir la parte siguiente. */
export function contextoParaContinuar(guion: Guion, parte: number) {
  const frases = guion.escenas.map((e) => e.texto);
  const lineamientos = guion.premisa?.lineamientos.length
    ? ` Lineamientos de la historia: ${guion.premisa.lineamientos.join(" ")}`
    : "";
  return {
    parte,
    resumen: ([guion.titulo, guion.gancho, ...frases].join(" ").slice(0, 1500) + lineamientos).slice(0, 1800),
    ultimaFrase: frases.at(-1) ?? guion.gancho,
  };
}
