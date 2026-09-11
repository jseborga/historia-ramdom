import { z } from "zod";

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
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().url().optional(),
  // Dias que se conservan los MP4 antes de la limpieza automatica.
  RETENCION_DIAS: z.coerce.number().int().min(1).default(15),
});

const resultado = Env.safeParse(process.env);

if (!resultado.success) {
  const detalle = resultado.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Configuracion invalida. Revisa las variables de entorno:\n${detalle}`);
  process.exit(1);
}

export const env = resultado.data;

export const DIR_VIDEOS = "videos";
export const DIR_TRABAJO = "trabajo";
export const DIR_MUSICA = "musica";
