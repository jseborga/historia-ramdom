import { z } from "zod";
import { env } from "../env.js";
import { leerJSON } from "../util/http.js";

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

const IDIOMAS: Record<string, string> = {
  es: "espanol latinoamericano neutro",
  en: "ingles estadounidense natural",
};

const sistema = (idioma: string) =>
  `Eres guionista de videos verticales cortos en ${IDIOMAS[idioma] ?? IDIOMAS.es}. ` +
  "Respondes unicamente con un objeto JSON valido, sin texto alrededor y sin bloques de codigo.";

async function pedirJSON(url: string, init: RequestInit, servicio: string) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const data = await leerJSON(res);
  if (!res.ok) {
    throw new Error(`${servicio} respondio ${res.status}: ${data?.error?.message ?? "sin detalle"}`);
  }
  return data;
}

/** Los modelos a veces envuelven el JSON en ```json ... ```; esto lo desenvuelve. */
function extraerJSON(texto: string): unknown {
  const limpio = texto.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio === -1 || fin === -1) throw new Error("El modelo no devolvio un objeto JSON");
  return JSON.parse(limpio.slice(inicio, fin + 1));
}

export async function textoConGroq(prompt: string, modelo = MODELOS.groq, idioma = "es") {
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
          { role: "system", content: sistema(idioma) },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    },
    "Groq",
  );
  return data.choices?.[0]?.message?.content as string;
}

export async function textoConOpenAI(prompt: string, modelo = MODELOS.openai, idioma = "es") {
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
          { role: "system", content: sistema(idioma) },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      }),
    },
    "OpenAI",
  );
  return data.choices?.[0]?.message?.content as string;
}

export async function textoConGemini(prompt: string, modelo = MODELOS.gemini, idioma = "es") {
  if (!env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  const data = await pedirJSON(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema(idioma) }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    },
    "Gemini",
  );
  const partes = data.candidates?.[0]?.content?.parts ?? [];
  return partes.map((p: { text?: string }) => p.text ?? "").join("") as string;
}

export async function textoConClaude(prompt: string, modelo = MODELOS.claude, idioma = "es") {
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
        system: sistema(idioma),
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
    "Para cada uno de estos textos de un video vertical, da de 1 a 3 palabras clave EN INGLES,",
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
): Promise<string> {
  const elegido = (motor && esMotor(motor) ? motor : null) ?? motorDisponible();
  if (!elegido) throw new Error("No hay ningun motor de IA configurado para redactar la narracion");

  const prompt = [
    "Reescribe el siguiente contenido como una NARRACION CORRIDA para leer en voz alta en un video vertical corto.",
    "Un solo texto seguido, en parrafos cortos, sin titulos, sin listas, sin comillas de dialogo.",
    "Puntuacion cuidada: frases completas terminadas en punto, comas donde se respira,",
    "signos de exclamacion e interrogacion de apertura y cierre donde el tono lo pida.",
    "Conserva el gancho como primera frase, corta y fuerte. No inventes datos nuevos.",
    estilo === "expresivo"
      ? "Ademas, anade indicaciones de tono ENTRE CORCHETES, muy breves y solo cuando ayuden, por ejemplo " +
        "[pausa], [susurrando], [con enfasis], [mas lento], [alegre], [serio]. Nunca mas de una por frase."
      : "Sin indicaciones de tono ni marcas: texto plano limpio.",
    'Devuelve exactamente este JSON: { "narracion": "..." }',
    "",
    "CONTENIDO:",
    fuente.slice(0, 6000),
  ].join("\n");

  const crudo = await (elegido === "claude"
    ? textoConClaude(prompt, MODELOS.claude, idioma)
    : elegido === "openai"
      ? textoConOpenAI(prompt, MODELOS.openai, idioma)
      : elegido === "gemini"
        ? textoConGemini(prompt, MODELOS.gemini, idioma)
        : textoConGroq(prompt, MODELOS.groq, idioma));
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
    .max(20),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
});

export type Guion = z.infer<typeof GuionSchema>;

export type PeticionGuion = {
  motor: string;
  /** Modelo concreto; si falta se usa el del entorno para ese motor. */
  modelo?: string | null;
  tipo: string;
  tema?: string;
  duracion: number;
  idioma?: string;
  /** false cuando el texto se lee en pantalla en vez de narrarse. */
  narrado?: boolean;
  /** Gancho ya probado que hay que reutilizar tal cual. */
  ganchoFijo?: string | null;
  evitar?: (string | null)[];
};

function construirPrompt({
  tipo,
  tema,
  duracion,
  ganchoFijo,
  narrado = true,
  evitar = [],
}: PeticionGuion) {
  // ~2,6 palabras por segundo de narracion pausada; 5 s de margen por escena.
  const palabras = Math.round(duracion * 2.6);
  const escenas = Math.max(4, Math.min(12, Math.round(duracion / 6)));
  const titulosPrevios = evitar.filter(Boolean).slice(0, 20) as string[];

  return [
    `Escribe el guion de un video vertical de ${tipo.toLowerCase()} para redes sociales.`,
    tema ? `Tema: ${tema}.` : "Tema: elige uno libremente, que sea universal y emotivo.",
    `Duracion objetivo: ${duracion} segundos (unas ${palabras} palabras en total).`,
    `Divide el guion en ${escenas} escenas de una o dos frases cada una.`,
    ganchoFijo
      ? `Usa EXACTAMENTE este gancho, sin cambiar ni una palabra: "${ganchoFijo}"`
      : "Escribe un gancho de una sola frase, de 12 palabras como maximo, que se lea en menos de 3 segundos. " +
        "Debe abrir un bucle (una pregunta sin responder, una afirmacion inesperada o una escena a medias). " +
        "Prohibido saludar, presentarse o decir 'en este video'.",
    "El gancho va aparte y ademas encabeza el video; las escenas continuan desde el.",
    "La ultima escena debe cerrar con una idea memorable, sin pedir likes ni seguidores.",
    narrado
      ? "No uses emojis, comillas tipograficas ni acotaciones de camara dentro del texto narrado."
      : "El texto NO se narra: se lee en pantalla como subtitulo. Frases cortas, " +
        "como mucho 14 palabras por escena, sin emojis ni acotaciones.",
    titulosPrevios.length
      ? `Evita repetir estos titulos ya publicados: ${titulosPrevios.join(" | ")}.`
      : "",
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "titulo": "titulo corto y concreto",',
    '  "gancho": "frase de enganche",',
    '  "escenas": [',
    '    { "texto": "frase narrada", "keywords": ["palabra en ingles para buscar video de stock", "otra"] }',
    "  ],",
    '  "hashtags": ["sinAlmohadilla", "otro"]',
    "}",
    "Las keywords deben estar en ingles, ser concretas y visuales (por ejemplo: 'rainy window', 'sunrise mountains').",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function generarGuion(peticion: PeticionGuion): Promise<Guion> {
  if (!esMotor(peticion.motor)) throw new Error(`Motor desconocido: ${peticion.motor}`);
  const motor = peticion.motor;
  const modelo = peticion.modelo?.trim() || MODELOS[motor];
  const prompt = construirPrompt(peticion);

  const idioma = peticion.idioma ?? "es";
  const crudo = await (motor === "claude"
    ? textoConClaude(prompt, modelo, idioma)
    : motor === "openai"
      ? textoConOpenAI(prompt, modelo, idioma)
      : motor === "gemini"
        ? textoConGemini(prompt, modelo, idioma)
        : textoConGroq(prompt, modelo, idioma));

  if (!crudo) throw new Error(`El motor ${motor} (${modelo}) no devolvio contenido`);
  return GuionSchema.parse(extraerJSON(crudo));
}
