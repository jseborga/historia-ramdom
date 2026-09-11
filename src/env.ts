import { z } from "zod";
import { claveDesdeBase64, descifrarCon, estaCifrado, PREFIJO_CIFRADO } from "./seguridad/aes.js";

/**
 * Variables que pueden guardarse cifradas con `enc:` en el panel del servidor.
 * Se descifran al arrancar con ENCRYPTION_KEY, que siempre va en claro.
 */
const CIFRABLES = [
  "DATABASE_URL",
  "REDIS_URL",
  "ADMIN_PASSWORD",
  "ADMIN_PASSWORD_HASH",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "GROQ_API_KEY",
  "PEXELS_API_KEY",
  "PIXABAY_API_KEY",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
] as const;

function descifrarEntorno(crudo: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const cifradas = CIFRABLES.filter((k) => crudo[k] && estaCifrado(crudo[k]!));
  if (!cifradas.length) return crudo;

  if (!crudo.ENCRYPTION_KEY) {
    console.error(
      `Hay variables con el prefijo "${PREFIJO_CIFRADO}" pero falta ENCRYPTION_KEY para descifrarlas.`,
    );
    process.exit(1);
  }

  const salida = { ...crudo };
  try {
    const clave = claveDesdeBase64(crudo.ENCRYPTION_KEY);
    for (const nombre of cifradas) {
      salida[nombre] = descifrarCon(clave, crudo[nombre]!.slice(PREFIJO_CIFRADO.length));
    }
  } catch (err) {
    // Nunca se imprime el valor: solo el nombre de la variable que falla.
    console.error(
      `No se pudieron descifrar las variables (${cifradas.join(", ")}). ` +
        `Comprueba que ENCRYPTION_KEY es la misma con la que se cifraron. Detalle: ${
          err instanceof Error ? err.message : err
        }`,
    );
    process.exit(1);
  }
  return salida;
}

const Env = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("production"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DATA_DIR: z.string().default("/data"),
  ENCRYPTION_KEY: z
    .string()
    .refine(
      (v) => Buffer.from(v, "base64").length === 32,
      "ENCRYPTION_KEY debe ser base64 de 32 bytes",
    ),

  // Login maestro creado al arrancar desde el entorno (opcional).
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).max(200).optional(),
  ADMIN_PASSWORD_HASH: z.string().startsWith("$argon2").optional(),

  // Limites de tamano, en megabytes.
  MAX_CLIP_MB: z.coerce.number().int().min(1).max(2000).default(150),
  MAX_VIDEO_MB: z.coerce.number().int().min(1).max(4000).default(300),

  // Proveedores de guion (usa los que tengas)
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),

  // Modelos por defecto: cambian a menudo, por eso se configuran sin tocar el codigo.
  ANTHROPIC_MODELO: z.string().default("claude-opus-5"),
  GEMINI_MODELO: z.string().default("gemini-2.5-flash"),
  OPENAI_MODELO: z.string().default("gpt-4o-mini"),
  GROQ_MODELO: z.string().default("llama-3.3-70b-versatile"),
  GEMINI_MODELO_VOZ: z.string().default("gemini-3.1-flash-tts-preview"),
  GEMINI_VOZ: z.string().default("Kore"),
  OPENAI_MODELO_VOZ: z.string().default("gpt-4o-mini-tts"),
  OPENAI_VOZ: z.string().default("coral"),

  // Clips
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),

  // TikTok (opcional)
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().url().optional(),

  // Dias que se conservan los MP4 antes de la limpieza automatica.
  RETENCION_DIAS: z.coerce.number().int().min(1).default(15),
});

const resultado = Env.safeParse(descifrarEntorno(process.env));

if (!resultado.success) {
  const detalle = resultado.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Configuracion invalida. Revisa las variables de entorno:\n${detalle}`);
  process.exit(1);
}

export const env = resultado.data;

export const MB = 1024 * 1024;
export const MAX_CLIP_BYTES = env.MAX_CLIP_MB * MB;
export const MAX_VIDEO_BYTES = env.MAX_VIDEO_MB * MB;

export const DIR_VIDEOS = "videos";
export const DIR_TRABAJO = "trabajo";
export const DIR_MUSICA = "musica";
