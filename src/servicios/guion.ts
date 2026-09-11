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
