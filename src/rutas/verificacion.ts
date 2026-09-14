import type { FastifyInstance } from "fastify";
import { env } from "../env.js";

/**
 * Verificación de propiedad del dominio para TikTok.
 *
 * Antes de aprobar la app, TikTok comprueba que el dominio es tuyo pidiendo un
 * archivo de firma en la raíz: `https://tu-dominio/tiktok<codigo>.txt`, con un
 * contenido exacto que te descargas del portal.
 *
 * Eso aquí no funciona solo. Cualquier ruta desconocida la atiende el frontend
 * (una SPA): pedir un .txt que no existe devuelve `index.html` con código 200 y
 * `text/html`, así que TikTok recibe una página web donde esperaba una línea de
 * texto y la verificación falla sin decir por qué. Esta ruta se registra antes
 * que el frontend y contesta lo que TikTok espera.
 *
 * Se configura pegando el **contenido** del archivo descargado en
 * `TIKTOK_VERIFICACION` (algo como `tiktok-developers-site-verification=ab12...`).
 * Sirve para cualquier nombre `tiktok*.txt`, porque el portal cambia el nombre
 * según la propiedad que verifiques.
 */

/** Nombres admitidos: los que usa el portal, y nada más. */
const NOMBRE = /^tiktok[A-Za-z0-9_-]*\.txt$/;

export async function rutasVerificacion(app: FastifyInstance) {
  app.get<{ Params: { archivo: string } }>("/:archivo", async (req, reply) => {
    const { archivo } = req.params;
    // Cualquier otra cosa sigue su camino: la SPA, las páginas legales, etc.
    if (!NOMBRE.test(archivo)) return reply.callNotFound();
    if (!env.TIKTOK_VERIFICACION) {
      return reply
        .code(404)
        .header("Content-Type", "text/plain; charset=utf-8")
        .send(
          "Falta TIKTOK_VERIFICACION: pega en esa variable el contenido del archivo que te " +
            "descargaste en el portal de TikTok y vuelve a intentar la verificacion.\n",
        );
    }
    return reply
      .header("Content-Type", "text/plain; charset=utf-8")
      // Que no se quede cacheado un valor viejo mientras TikTok reintenta.
      .header("Cache-Control", "no-store")
      .send(`${env.TIKTOK_VERIFICACION.trim()}\n`);
  });
}
