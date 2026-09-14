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
  "OPENVERSE_TOKEN",
  "AMAZON_ACCESS_KEY",
  "AMAZON_SECRET_KEY",
  "TIKTOK_CLIENT_KEY",
  "TIKTOK_CLIENT_SECRET",
  "REDDIT_CLIENT_ID",
  "REDDIT_CLIENT_SECRET",
  "API_TOKEN",
] as const;

/**
 * Una variable escrita pero vacia (`API_TOKEN=`) es lo normal al pegar una
 * plantilla en el panel: significa "no la uso", no "vale cadena vacia". Sin
 * esto, las opcionales fallarian la validacion y las que tienen valor por
 * defecto se quedarian en "" en vez de tomarlo.
 */
function quitarVacias(crudo: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const salida: NodeJS.ProcessEnv = {};
  for (const [nombre, valor] of Object.entries(crudo)) {
    if (typeof valor === "string" && valor.trim() === "") continue;
    salida[nombre] = valor;
  }
  return salida;
}

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
  /**
   * Tope de un videoclip musical, en segundos. Es mayor que el de las
   * historias porque aqui se encadenan varias canciones: 15 minutos por
   * defecto, que en YouTube es normal y en TikTok ya no cabe.
   */
  MAX_VIDEOCLIP_SEG: z.coerce.number().int().min(60).max(3600).default(900),
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
  // Voz local del servidor (espeak-ng): sin clave, sin red, algo robotica.
  VOZ_LOCAL_VOZ: z.string().default("es-419"),
  VOZ_LOCAL_VELOCIDAD: z.coerce.number().int().min(80).max(300).default(150),
  /**
   * Modelo de sintesis de voz de Gemini. Es una PREFERENCIA: si la clave no lo
   * tiene, la app pregunta a la API cuales hay y usa el mejor disponible.
   */
  GEMINI_MODELO_VOZ: z.string().default("gemini-2.5-flash-preview-tts"),
  GEMINI_VOZ: z.string().default("Kore"),
  OPENAI_MODELO_VOZ: z.string().default("gpt-4o-mini-tts"),
  OPENAI_VOZ: z.string().default("coral"),

  // Clips
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  /**
   * Openverse funciona sin registrarse (20 peticiones por minuto, 200 al dia).
   * Con un token de su API esos limites suben; no hace falta para empezar.
   */
  OPENVERSE_TOKEN: z.string().optional(),

  /**
   * Amazon Afiliados (opcional). Sin las tres primeras no hay API: la seccion
   * de productos sigue funcionando pegando el enlace a mano, pero sin fotos
   * ni datos del producto, porque sacarlos de la ficha publica esta prohibido.
   */
  AMAZON_ACCESS_KEY: z.string().optional(),
  AMAZON_SECRET_KEY: z.string().optional(),
  /** La etiqueta de afiliado ("miweb-21"): sin ella no hay comision. */
  AMAZON_PARTNER_TAG: z.string().max(40).optional(),
  /** Tienda por defecto: com, es, com.mx, com.br, co.uk, de, fr, it o ca. */
  AMAZON_MERCADO: z.string().max(10).default("com"),

  /**
   * Identidad del titular para las paginas de Terminos y Privacidad, que
   * TikTok exige publicadas en el dominio para aprobar la app. Sin ellas las
   * paginas se sirven igual, pero avisan de que faltan datos.
   */
  LEGAL_TITULAR: z.string().max(120).optional(),
  LEGAL_CONTACTO: z.string().email().optional(),
  LEGAL_JURISDICCION: z.string().max(80).default("Bolivia"),

  // TikTok (opcional)
  /**
   * Permisos que se piden al conectar la cuenta:
   *   user.info.basic  perfil (obligatorio)
   *   video.upload     enviar a borradores
   *   video.list       leer las metricas de tus videos
   *   video.publish    publicar directo (solo con la auditoria superada)
   */
  TIKTOK_SCOPES: z.string().default("user.info.basic,video.upload,video.list"),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  /**
   * Contenido exacto del archivo de verificacion de dominio que se descarga
   * del portal de TikTok. Se sirve en /tiktok<codigo>.txt, que sin esto lo
   * atenderia el frontend devolviendo HTML y la verificacion fallaria.
   */
  TIKTOK_VERIFICACION: z.string().max(200).optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().url().optional(),

  /**
   * Token para clientes sin navegador (el servidor MCP). Se envia como
   * `Authorization: Bearer ...`. Si esta vacio, solo vale la cookie de sesion.
   */
  API_TOKEN: z.string().min(32).optional(),

  // Reddit como detector de temas (opcional, apagado por defecto).
  REDDIT_ACTIVO: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  REDDIT_CLIENT_ID: z.string().optional(),
  REDDIT_CLIENT_SECRET: z.string().optional(),
  REDDIT_USER_AGENT: z.string().default("estudio-voz-en-off/1.0"),
  /** Listas separadas por comas, sin el prefijo r/. */
  REDDIT_SUBS_ES: z.string().default("PreguntaleAReddit,es"),
  REDDIT_SUBS_EN: z.string().default("AskReddit,tifu,ShortStories"),
  REDDIT_PUNTOS_MINIMOS: z.coerce.number().int().min(0).default(500),
  /** Horario de la busqueda de ideas. */
  REDDIT_CRON: z.string().default("0 6 * * *"),

  // Dias que se conservan los MP4 antes de la limpieza automatica.
  RETENCION_DIAS: z.coerce.number().int().min(1).default(15),
});

const resultado = Env.safeParse(descifrarEntorno(quitarVacias(process.env)));

if (!resultado.success) {
  const detalle = resultado.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  console.error(`Configuracion invalida. Revisa las variables de entorno:\n${detalle}`);
  process.exit(1);
}

export const env = {
  ...resultado.data,
  // Si no se indica, el callback de TikTok cuelga del dominio publico.
  TIKTOK_REDIRECT_URI:
    resultado.data.TIKTOK_REDIRECT_URI ??
    `${resultado.data.PUBLIC_URL.replace(/\/$/, "")}/api/tiktok/callback`,
};

export const MB = 1024 * 1024;
export const MAX_CLIP_BYTES = env.MAX_CLIP_MB * MB;
/**
 * Tope de un audio subido (voz o cancion). Un WAV de cinco minutos ronda los
 * 50 MB, asi que 80 deja margen sin abrir la puerta a subidas enormes.
 */
export const MAX_AUDIO_MB = 80;
export const MAX_AUDIO_BYTES = MAX_AUDIO_MB * MB;
export const MAX_VIDEO_BYTES = env.MAX_VIDEO_MB * MB;

export const DIR_VIDEOS = "videos";
export const DIR_TRABAJO = "trabajo";
export const DIR_MUSICA = "musica";
export const DIR_PROYECTOS = "proyectos";
/** Biblioteca de video y foto: lo subido y lo guardado de los bancos. */
export const DIR_MEDIOS = "medios";
