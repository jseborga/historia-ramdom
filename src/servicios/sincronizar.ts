import { db } from "../db.js";
import { guardarMetrica } from "./metricas.js";
import { accessTokenVigente, consultarVideos, estadoPublicacion } from "./tiktok.js";

/**
 * Trae de TikTok las metricas de las historias ya publicadas por API.
 *
 * Lo que TikTok entrega: vistas, likes, comentarios y compartidos.
 * Lo que NO entrega: el tiempo medio de visualizacion, que solo esta en
 * TikTok Studio y se copia a mano desde la pantalla de rendimiento.
 */
export async function sincronizarMetricas() {
  const cuentas = await db.tikTokCuenta.count();
  if (!cuentas) return { revisadas: 0, actualizadas: 0, motivo: "sin cuenta conectada" };

  const publicadas = await db.historia.findMany({
    where: { estado: "SUBIDA", publishId: { not: null } },
    select: { id: true, publishId: true, videoTikTok: true },
    orderBy: { creadaEn: "desc" },
    take: 60,
  });
  if (!publicadas.length) return { revisadas: 0, actualizadas: 0 };

  const token = await accessTokenVigente();

  // 1. Resolver el id publico del video para las que aun no lo tienen.
  for (const h of publicadas.filter((p) => !p.videoTikTok)) {
    const estado = await estadoPublicacion(token, h.publishId!).catch(() => null);
    const publicado = estado?.publicaly_available_post_id?.[0];
    if (publicado) {
      h.videoTikTok = String(publicado);
      await db.historia.update({ where: { id: h.id }, data: { videoTikTok: h.videoTikTok } });
    }
  }

  const conVideo = publicadas.filter((p) => p.videoTikTok);
  if (!conVideo.length) return { revisadas: publicadas.length, actualizadas: 0 };

  // 2. Pedir las metricas y guardarlas.
  const videos = await consultarVideos(token, conVideo.map((p) => p.videoTikTok!));
  const porId = new Map(videos.map((v) => [String(v.id), v]));

  let actualizadas = 0;
  for (const h of conVideo) {
    const v = porId.get(h.videoTikTok!);
    if (!v) continue;
    const actual = await db.metrica.findUnique({ where: { historiaId: h.id } });
    await guardarMetrica(h.id, {
      vistas: v.view_count ?? 0,
      likes: v.like_count ?? 0,
      comentarios: v.comment_count ?? 0,
      compartidos: v.share_count ?? 0,
      guardados: v.collect_count ?? 0,
      duracionSeg: v.duration ?? actual?.duracionSeg ?? null,
      // El tiempo de permanencia introducido a mano no se pisa.
      tiempoPromedioSeg: actual?.tiempoPromedioSeg ?? null,
      fuente: "API",
    });
    actualizadas++;
  }

  return { revisadas: publicadas.length, actualizadas };
}
