import type { FastifyInstance } from "fastify";
import { MOTORES, MODELOS } from "../servicios/guion.js";
import {
  VOCES,
  VOZ_POR_DEFECTO,
  VOZ_GEMINI_POR_DEFECTO,
  VOZ_OPENAI_POR_DEFECTO,
  vocesLocalesDisponibles,
  mejorVozLocal,
  GENERO_VOZ_IA,
} from "../servicios/voz.js";
import { listarMusica } from "../almacen.js";
import { catalogoCategorias, catalogoAreas, CATEGORIA_ALEATORIA } from "../servicios/categorias.js";
import { PERFILES } from "../render/calidad.js";
import { modelosVozGemini, modeloVozGemini } from "../servicios/voz.js";
import { tiktokConfigurado } from "../servicios/tiktok.js";
import { redditConfigurado } from "../servicios/reddit.js";
import { env } from "../env.js";
import { db } from "../db.js";

/** Lo que el frontend necesita para poblar selectores, sin exponer claves. */
export async function rutasCatalogo(app: FastifyInstance) {
  app.get("/api/salud", async () => ({ ok: true }));

  /**
   * Modelos de voz que de verdad tiene la clave de Gemini. Se pregunta a la
   * API en vez de dar por bueno el nombre del entorno, porque Google los
   * renombra y un nombre viejo solo da 404 al generar.
   */
  app.get("/api/voz/modelos", async () => {
    if (!env.GEMINI_API_KEY) return { gemini: [], elegido: null, configurado: env.GEMINI_MODELO_VOZ };
    try {
      const gemini = await modelosVozGemini(true);
      return { gemini, elegido: await modeloVozGemini(env.GEMINI_MODELO_VOZ), configurado: env.GEMINI_MODELO_VOZ };
    } catch (err) {
      return {
        gemini: [],
        elegido: null,
        configurado: env.GEMINI_MODELO_VOZ,
        error: err instanceof Error ? err.message : "No se pudo consultar",
      };
    }
  });

  app.get("/api/catalogo", async () => {
    const cuentas = await db.tikTokCuenta.count();
    const claves: Record<string, string | undefined> = {
      groq: env.GROQ_API_KEY,
      openai: env.OPENAI_API_KEY,
      gemini: env.GEMINI_API_KEY,
      claude: env.ANTHROPIC_API_KEY,
    };

    return {
      motores: MOTORES.map((m) => ({
        id: m,
        modelo: MODELOS[m],
        disponible: Boolean(claves[m]),
      })),
      voces: VOCES,
      /** Solo las que funcionan en esta maquina, con su calidad. */
      vocesLocales: await vocesLocalesDisponibles(),
      vozPorDefecto: { ...VOZ_POR_DEFECTO, nombre: await mejorVozLocal("es") },
      vozGeminiPorDefecto: VOZ_GEMINI_POR_DEFECTO,
      vozOpenAIPorDefecto: VOZ_OPENAI_POR_DEFECTO,
      musica: await listarMusica(),
      clips: {
        pexels: Boolean(env.PEXELS_API_KEY),
        pixabay: Boolean(env.PIXABAY_API_KEY),
      },
      tiktok: {
        configurado: tiktokConfigurado(),
        cuentasConectadas: cuentas,
        permisos: env.TIKTOK_SCOPES.split(",").map((s) => s.trim()),
      },
      reddit: { configurado: redditConfigurado() },
      idiomas: ["es", "en"],
      regiones: [
        { id: "bolivia", nombre: "Bolivia (con modismos bolivianos)" },
        { id: "latam", nombre: "Latinoamérica (neutro)" },
        { id: "eeuu", nombre: "EE. UU. (inglés)" },
      ],
      generosIA: GENERO_VOZ_IA,
      /** Categorías y subcategorías de historia; `aleatoria` sortea una cada vez. */
      categorias: catalogoCategorias(),
      categoriaAleatoria: CATEGORIA_ALEATORIA,
      /** Las dos áreas (historias e ideas), cada una con su valor "al azar". */
      areas: catalogoAreas(),
      /** Perfiles de compresión, con lo que cambia cada uno. */
      calidades: Object.values(PERFILES).map((c) => ({
        id: c.id,
        nombre: c.nombre,
        nota: c.nota,
        escala: c.escala,
        fps: c.fps,
      })),
      limites: { clipMB: env.MAX_CLIP_MB, videoMB: env.MAX_VIDEO_MB, videoclipSeg: env.MAX_VIDEOCLIP_SEG },
      retencionDias: env.RETENCION_DIAS,
    };
  });
}
