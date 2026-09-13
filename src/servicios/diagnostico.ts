import { spawn } from "node:child_process";
import { writeFile, unlink, stat } from "node:fs/promises";
import { join } from "node:path";
import { db } from "../db.js";
import { env } from "../env.js";
import { conexion } from "../cola/conexion.js";
import { rutaTrabajo } from "../almacen.js";
import { MODELOS } from "./guion.js";
import { redditConfigurado } from "./reddit.js";
import { fuentesDisponibles } from "../render/fuentes.js";
import { vocesLocalesDisponibles, modelosVozGemini, modeloVozGemini, vozGemini } from "./voz.js";
import { tiktokConfigurado } from "./tiktok.js";

/**
 * Comprobacion de que todo lo que la app necesita responde de verdad.
 *
 * Cada prueba hace la llamada mas barata que demuestre que la clave sirve
 * (listar modelos, una busqueda de un resultado), nunca una generacion.
 * Los mensajes de error jamas incluyen la clave: solo el codigo de respuesta.
 */

export type Estado = "ok" | "error" | "sin_configurar";

export type Prueba = {
  id: string;
  nombre: string;
  grupo: "Infraestructura" | "Guion" | "Voz" | "Clips" | "Publicacion";
  estado: Estado;
  detalle: string;
  ms: number;
};

const SIN_CONFIGURAR = "no_configurado" as const;

/** Ninguna prueba puede colgar la pagina: si no contesta a tiempo, es un fallo. */
const LIMITE_MS = 15_000;

function conLimite<T>(promesa: Promise<T>, ms = LIMITE_MS): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<never>((_, rechazar) =>
      setTimeout(() => rechazar(new Error(`Sin respuesta en ${ms / 1000} s`)), ms).unref(),
    ),
  ]);
}

async function medir(
  id: string,
  nombre: string,
  grupo: Prueba["grupo"],
  fn: () => Promise<string | typeof SIN_CONFIGURAR>,
  /** Sintetizar voz tarda mas que listar modelos: algunas pruebas piden mas. */
  limiteMs = LIMITE_MS,
): Promise<Prueba> {
  const inicio = Date.now();
  try {
    const detalle = await conLimite(fn(), limiteMs);
    return detalle === SIN_CONFIGURAR
      ? { id, nombre, grupo, estado: "sin_configurar", detalle: "Sin clave configurada", ms: 0 }
      : { id, nombre, grupo, estado: "ok", detalle, ms: Date.now() - inicio };
  } catch (err) {
    return {
      id,
      nombre,
      grupo,
      estado: "error",
      detalle: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      ms: Date.now() - inicio,
    };
  }
}

/** Llama a un endpoint de solo lectura y falla con el codigo, nunca con la clave. */
async function pedir(url: string, servicio: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const pista = res.status === 401 || res.status === 403 ? " (clave rechazada)" : "";
    throw new Error(`${servicio} respondio ${res.status}${pista}`);
  }
  return res;
}

function version(programa: string) {
  return new Promise<string>((resolve, reject) => {
    // ffmpeg entiende -version; espeak-ng, --version.
    const p = spawn(programa, [programa === "espeak-ng" ? "--version" : "-version"]);
    let salida = "";
    p.stdout.on("data", (d) => (salida += d));
    p.on("error", () => reject(new Error(`${programa} no esta instalado`)));
    p.on("close", (code) =>
      code === 0
        ? resolve(salida.split("\n")[0].slice(0, 80))
        : reject(new Error(`${programa} termino con codigo ${code}`)),
    );
  });
}

export async function diagnosticar(): Promise<Prueba[]> {
  return Promise.all([
    // ---- Infraestructura ----
    medir("postgres", "Base de datos", "Infraestructura", async () => {
      await db.$queryRaw`SELECT 1`;
      const historias = await db.historia.count();
      return `Conectada · ${historias} historias`;
    }),

    medir("redis", "Redis (cola y cache)", "Infraestructura", async () => {
      const pong = await conexion.ping();
      return `Responde ${pong}`;
    }),

    medir("ffmpeg", "ffmpeg", "Infraestructura", () => version("ffmpeg")),
    medir("ffprobe", "ffprobe", "Infraestructura", () => version("ffprobe")),

    medir("disco", "Volumen de datos", "Infraestructura", async () => {
      const prueba = join(rutaTrabajo(), `.diagnostico-${Date.now()}`);
      await writeFile(prueba, "ok");
      await unlink(prueba);
      return `Se puede escribir en ${env.DATA_DIR}`;
    }),

    medir("fuentes", "Tipografias", "Infraestructura", async () => {
      const lista = await fuentesDisponibles();
      if (!lista.length) throw new Error("No se encontro ninguna fuente instalada");
      return `${lista.length} disponibles: ${lista.map((f) => f.nombre).join(", ")}`;
    }),

    // ---- Motores de guion ----
    medir("groq", "Groq", "Guion", async () => {
      if (!env.GROQ_API_KEY) return SIN_CONFIGURAR;
      const res = await pedir("https://api.groq.com/openai/v1/models", "Groq", {
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      });
      const data = (await res.json()) as { data?: { id: string }[] };
      const existe = data.data?.some((m) => m.id === MODELOS.groq);
      return existe
        ? `Clave valida · ${MODELOS.groq} disponible`
        : `Clave valida, pero ${MODELOS.groq} no aparece en la lista`;
    }),

    medir("openai", "OpenAI", "Guion", async () => {
      if (!env.OPENAI_API_KEY) return SIN_CONFIGURAR;
      const res = await pedir("https://api.openai.com/v1/models", "OpenAI", {
        headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
      });
      const data = (await res.json()) as { data?: { id: string }[] };
      const existe = data.data?.some((m) => m.id === MODELOS.openai);
      return existe
        ? `Clave valida · ${MODELOS.openai} disponible`
        : `Clave valida, pero ${MODELOS.openai} no aparece en la lista`;
    }),

    medir("gemini", "Google AI Studio", "Guion", async () => {
      if (!env.GEMINI_API_KEY) return SIN_CONFIGURAR;
      const res = await pedir(
        "https://generativelanguage.googleapis.com/v1beta/models",
        "Gemini",
        { headers: { "x-goog-api-key": env.GEMINI_API_KEY } },
      );
      const data = (await res.json()) as { models?: { name: string }[] };
      const nombres = (data.models ?? []).map((m) => m.name.replace(/^models\//, ""));
      const existe = nombres.includes(MODELOS.gemini);
      return existe
        ? `Clave valida · ${MODELOS.gemini} disponible`
        : `Clave valida, pero ${MODELOS.gemini} no aparece (hay ${nombres.length} modelos)`;
    }),

    medir("claude", "Anthropic", "Guion", async () => {
      if (!env.ANTHROPIC_API_KEY) return SIN_CONFIGURAR;
      const res = await pedir("https://api.anthropic.com/v1/models", "Anthropic", {
        headers: {
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
      });
      const data = (await res.json()) as { data?: { id: string }[] };
      const existe = data.data?.some((m) => m.id === MODELOS.claude);
      return existe
        ? `Clave valida · ${MODELOS.claude} disponible`
        : `Clave valida, pero ${MODELOS.claude} no aparece en la lista`;
    }),

    // ---- Voz ----
    medir("voz_local", "Voces locales", "Voz", async () => {
      const lista = await vocesLocalesDisponibles();
      if (!lista.length) throw new Error("No hay ninguna voz local: instala espeak-ng, mbrola o piper");
      const mejor = [...lista].sort((a, b) => b.calidad - a.calidad)[0];
      return `${lista.length} voces · la mejor: ${mejor.nombre}`;
    }),

    // No basta con que el modelo exista: se sintetiza una palabra de verdad,
    // que es lo unico que demuestra que la voz va a funcionar al renderizar.
    medir("voz_gemini", "Voz de Google AI Studio", "Voz", async () => {
      if (!env.GEMINI_API_KEY) return SIN_CONFIGURAR;
      const disponibles = await modelosVozGemini(true);
      if (!disponibles.length) {
        throw new Error("La clave no tiene ningun modelo de voz (tts) disponible");
      }
      const elegido = await modeloVozGemini(env.GEMINI_MODELO_VOZ);
      const prueba = join(rutaTrabajo(), `diagnostico-voz-${Date.now()}.wav`);
      try {
        await vozGemini("Hola.", prueba, elegido, env.GEMINI_VOZ);
        const { size } = await stat(prueba);
        if (size < 1000) throw new Error("El audio salio vacio");
        const aviso = elegido === env.GEMINI_MODELO_VOZ ? "" : ` (GEMINI_MODELO_VOZ apunta a otro que no existe)`;
        return `${elegido} sintetiza · ${(size / 1024).toFixed(0)} kB${aviso} · disponibles: ${disponibles.join(", ")}`;
      } finally {
        await unlink(prueba).catch(() => {});
      }
    }, 45_000),

    medir("voz_openai", "Voz de OpenAI", "Voz", async () => {
      if (!env.OPENAI_API_KEY) return SIN_CONFIGURAR;
      const res = await pedir(
        `https://api.openai.com/v1/models/${env.OPENAI_MODELO_VOZ}`,
        "OpenAI TTS",
        { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } },
      );
      await res.json();
      return `${env.OPENAI_MODELO_VOZ} existe`;
    }),

    // ---- Clips ----
    medir("pexels", "Pexels", "Clips", async () => {
      if (!env.PEXELS_API_KEY) return SIN_CONFIGURAR;
      const res = await pedir(
        "https://api.pexels.com/videos/search?query=sky&per_page=1",
        "Pexels",
        { headers: { Authorization: env.PEXELS_API_KEY } },
      );
      const restantes = res.headers.get("x-ratelimit-remaining");
      return `Clave valida${restantes ? ` · quedan ${restantes} peticiones` : ""}`;
    }),

    medir("pixabay", "Pixabay", "Clips", async () => {
      if (!env.PIXABAY_API_KEY) return SIN_CONFIGURAR;
      const url = new URL("https://pixabay.com/api/videos/");
      url.search = new URLSearchParams({
        key: env.PIXABAY_API_KEY,
        q: "sky",
        per_page: "3",
      }).toString();
      const res = await pedir(url.toString(), "Pixabay");
      const data = (await res.json()) as { totalHits?: number };
      return `Clave valida · ${data.totalHits ?? 0} resultados de prueba`;
    }),

    // ---- Publicacion ----
    medir("tiktok", "TikTok", "Publicacion", async () => {
      if (!tiktokConfigurado()) return SIN_CONFIGURAR;
      const cuenta = await db.tikTokCuenta.findFirst({ orderBy: { creadaEn: "desc" } });
      if (!cuenta) throw new Error("Claves puestas pero ninguna cuenta conectada");
      const caducado = cuenta.expiraEn.getTime() < Date.now();
      return `Cuenta conectada · permisos: ${cuenta.scopes}${
        caducado ? " · token caducado (se renovara solo)" : ""
      }`;
    }),

    medir("reddit", "Reddit", "Publicacion", async () => {
      if (!redditConfigurado()) return SIN_CONFIGURAR;
      const basic = Buffer.from(
        `${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`,
      ).toString("base64");
      await pedir("https://www.reddit.com/api/v1/access_token", "Reddit", {
        method: "POST",
        headers: {
          Authorization: `Basic ${basic}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": env.REDDIT_USER_AGENT,
        },
        body: new URLSearchParams({ grant_type: "client_credentials" }),
      });
      return "Credenciales validas";
    }),
  ]);
}
