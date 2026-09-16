import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { IDIOMAS, MOTORES, MODELOS } from "../servicios/guion.js";
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
  /**
   * Salud del servidor, y **de qué build** se trata.
   *
   * Sin esto, comprobar si un despliegue cogió el código nuevo es adivinar:
   * la app contesta igual de bien con la versión de ayer. `compilado` es la
   * fecha del archivo que se está ejecutando (la del momento en que se
   * construyó la imagen), así que un `curl /api/salud` basta para saber si el
   * redespliegue entró o si sigue corriendo el de antes.
   */
  app.get("/api/salud", async () => {
    const compilado = await stat(fileURLToPath(import.meta.url))
      .then((s) => s.mtime.toISOString())
      .catch(() => null);
    return {
      ok: true,
      compilado,
      arrancado: new Date(Date.now() - Math.round(process.uptime() * 1000)).toISOString(),
      funciones: {
        /** Rutas que no existían en versiones anteriores; delatan un build viejo. */
        verificacionTikTok: true,
        paginasLegales: true,
        productosAmazon: true,
      },
    };
  });

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
        /** Los cuatro abiertos no piden clave: siempre están. */
        nasa: true,
        openverse: true,
        wikimedia: true,
        archive: true,
      },
      /** Bancos donde se puede buscar ahora mismo, con su nombre y su licencia. */
      bancos: [
        { id: "pexels", nombre: "Pexels", nota: "Vídeos y fotos libres, con autor.", listo: Boolean(env.PEXELS_API_KEY) },
        { id: "pixabay", nombre: "Pixabay", nota: "Vídeos y fotos libres, con autor.", listo: Boolean(env.PIXABAY_API_KEY) },
        { id: "nasa", nombre: "NASA", nota: "Espacio, planetas y misiones; dominio público y sin clave.", listo: true },
        {
          id: "openverse",
          nombre: "Openverse",
          nota: "Cientos de millones de fotos con licencia libre (solo uso comercial y modificable). Sin clave.",
          listo: true,
        },
        {
          id: "wikimedia",
          nombre: "Wikimedia Commons",
          nota: "Retratos, cuadros, mapas y archivo histórico; también vídeo. Sin clave.",
          listo: true,
        },
        {
          id: "archive",
          nombre: "Internet Archive",
          nota: "Cine y noticiarios de dominio público, material de archivo real. Sin clave.",
          listo: true,
        },
      ],
      medios: [
        { id: "video", nombre: "Vídeos" },
        { id: "imagen", nombre: "Fotos (se animan con movimiento)" },
      ],
      tiktok: {
        configurado: tiktokConfigurado(),
        cuentasConectadas: cuentas,
        permisos: env.TIKTOK_SCOPES.split(",").map((s) => s.trim()),
      },
      reddit: { configurado: redditConfigurado() },
      /** Los tres, con su nombre: el selector no tiene que saberlos de memoria. */
      idiomas: IDIOMAS,
      nombresIdioma: {
        es: "Español",
        en: "Inglés",
        spanglish: "Spanglish (español con inglés dentro)",
      },
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
