import type { FastifyInstance } from "fastify";
import { MOTORES, MODELOS } from "../servicios/guion.js";
import { VOCES, VOZ_POR_DEFECTO } from "../servicios/voz.js";
import { listarMusica } from "../almacen.js";
import { tiktokConfigurado } from "../servicios/tiktok.js";
import { env } from "../env.js";
import { db } from "../db.js";

/** Lo que el frontend necesita para poblar selectores, sin exponer claves. */
export async function rutasCatalogo(app: FastifyInstance) {
  app.get("/api/salud", async () => ({ ok: true }));

  app.get("/api/catalogo", async () => {
    const cuentas = await db.tikTokCuenta.count();
    return {
      motores: MOTORES.map((m) => ({
        id: m,
        modelo: MODELOS[m],
        disponible: Boolean(
          {
            groq: env.GROQ_API_KEY,
            openai: env.OPENAI_API_KEY,
            gemini: env.GEMINI_API_KEY,
            claude: env.ANTHROPIC_API_KEY,
          }[m],
        ),
      })),
      voces: VOCES,
      vozPorDefecto: VOZ_POR_DEFECTO,
      musica: await listarMusica(),
      clips: {
        pexels: Boolean(env.PEXELS_API_KEY),
        pixabay: Boolean(env.PIXABAY_API_KEY),
      },
      tiktok: { configurado: tiktokConfigurado(), cuentasConectadas: cuentas },
      retencionDias: env.RETENCION_DIAS,
    };
  });
}
