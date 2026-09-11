import { open, stat } from "node:fs/promises";
import { db } from "../db.js";
import { env } from "../env.js";
import { cifrar, descifrar } from "../seguridad/cifrado.js";
import { leerJSON } from "../util/http.js";

const API = "https://open.tiktokapis.com/v2";
const MB = 1024 * 1024;
/** Margen para no usar un token que caduca en mitad de la subida. */
const MARGEN_MS = 5 * 60_000;

export function tiktokConfigurado() {
  return Boolean(env.TIKTOK_CLIENT_KEY && env.TIKTOK_CLIENT_SECRET && env.TIKTOK_REDIRECT_URI);
}

export async function guardarTokens(t: {
  open_id: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}) {
  const datos = {
    accessTokenEnc: cifrar(t.access_token),
    refreshTokenEnc: cifrar(t.refresh_token),
    expiraEn: new Date(Date.now() + t.expires_in * 1000),
    scopes: t.scope,
  };
  return db.tikTokCuenta.upsert({
    where: { openId: t.open_id },
    create: { openId: t.open_id, ...datos },
    update: datos,
  });
}

async function pedirToken(cuerpo: Record<string, string>) {
  const res = await fetch(`${API}/oauth/token/`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY!,
      client_secret: env.TIKTOK_CLIENT_SECRET!,
      ...cuerpo,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const t = await leerJSON(res);
  if (!res.ok || !t?.access_token) {
    throw new Error(`TikTok no entrego el token: ${t?.error_description ?? res.status}`);
  }
  return t;
}

export const canjearCodigo = (code: string) =>
  pedirToken({ code, grant_type: "authorization_code", redirect_uri: env.TIKTOK_REDIRECT_URI! });

/**
 * Devuelve un access token valido: si el guardado esta por caducar,
 * pide uno nuevo con el refresh token y vuelve a cifrar ambos.
 */
export async function accessTokenVigente() {
  const cuenta = await db.tikTokCuenta.findFirst({ orderBy: { creadaEn: "desc" } });
  if (!cuenta) throw new Error("No hay ninguna cuenta de TikTok conectada");

  if (cuenta.expiraEn.getTime() - Date.now() > MARGEN_MS) {
    return descifrar(cuenta.accessTokenEnc);
  }

  const t = await pedirToken({
    grant_type: "refresh_token",
    refresh_token: descifrar(cuenta.refreshTokenEnc),
  });
  await guardarTokens({ ...t, open_id: t.open_id ?? cuenta.openId });
  return t.access_token as string;
}

async function leerRango(archivo: string, inicio: number, fin: number) {
  const fh = await open(archivo, "r");
  try {
    const buf = Buffer.alloc(fin - inicio + 1);
    await fh.read(buf, 0, buf.length, inicio);
    return buf;
  } finally {
    await fh.close();
  }
}

/**
 * El archivo se sube en trozos: si pesa 64 MB o menos va en uno solo;
 * si pesa mas, en trozos de 10 MB y el ultimo absorbe el resto.
 */
function plan(size: number) {
  const trozo = size <= 64 * MB ? size : 10 * MB;
  return { trozo, total: Math.max(1, Math.floor(size / trozo)) };
}

async function subirTrozos(uploadUrl: string, archivo: string, size: number) {
  const { trozo, total } = plan(size);
  for (let i = 0; i < total; i++) {
    const inicio = i * trozo;
    const fin = i === total - 1 ? size - 1 : inicio + trozo - 1;
    const r = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Range": `bytes ${inicio}-${fin}/${size}`,
      },
      body: await leerRango(archivo, inicio, fin),
      signal: AbortSignal.timeout(300_000),
    });
    if (![200, 201, 206].includes(r.status)) {
      throw new Error(`Fallo el trozo ${i + 1} de ${total}: ${r.status}`);
    }
  }
}

async function iniciar(ruta: string, accessToken: string, cuerpo: Record<string, unknown>) {
  const res = await fetch(`${API}${ruta}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(60_000),
  });
  const j = await leerJSON(res);
  if (j?.error?.code !== "ok") {
    throw new Error(`TikTok rechazo la subida: ${j?.error?.code} ${j?.error?.message ?? ""}`);
  }
  return j.data as { upload_url: string; publish_id: string };
}

/** Opcion B: el video llega a los borradores y la publicacion se termina en la app. */
export async function subirABorradores(accessToken: string, archivo: string) {
  const { size } = await stat(archivo);
  const { trozo, total } = plan(size);
  const { upload_url, publish_id } = await iniciar(
    "/post/publish/inbox/video/init/",
    accessToken,
    {
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: trozo,
        total_chunk_count: total,
      },
    },
  );
  await subirTrozos(upload_url, archivo, size);
  return publish_id;
}

export async function consultarCreador(accessToken: string) {
  const res = await fetch(`${API}/post/publish/creator_info/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    signal: AbortSignal.timeout(30_000),
  });
  const j = await leerJSON(res);
  if (j?.error?.code !== "ok") {
    throw new Error(`TikTok no devolvio los datos del creador: ${j?.error?.code}`);
  }
  return j.data as { privacy_level_options: string[]; creator_nickname?: string };
}

/**
 * Opcion C: publicacion directa. Requiere el scope video.publish y, para
 * publicar en publico, haber superado la auditoria de TikTok.
 */
export async function publicarDirecto(accessToken: string, archivo: string, titulo: string) {
  const { size } = await stat(archivo);
  const { trozo, total } = plan(size);
  const creador = await consultarCreador(accessToken);
  const privacidad =
    creador.privacy_level_options?.find((p) => p === "SELF_ONLY") ??
    creador.privacy_level_options?.[0];
  if (!privacidad) throw new Error("TikTok no ofrecio ninguna opcion de privacidad");

  const { upload_url, publish_id } = await iniciar("/post/publish/video/init/", accessToken, {
    post_info: {
      title: titulo.slice(0, 2200),
      privacy_level: privacidad,
      is_aigc: true,
    },
    source_info: {
      source: "FILE_UPLOAD",
      video_size: size,
      chunk_size: trozo,
      total_chunk_count: total,
    },
  });
  await subirTrozos(upload_url, archivo, size);
  return publish_id;
}

export async function estadoPublicacion(accessToken: string, publishId: string) {
  const res = await fetch(`${API}/post/publish/status/fetch/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify({ publish_id: publishId }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await leerJSON(res);
  if (j?.error?.code !== "ok") {
    throw new Error(`TikTok no devolvio el estado: ${j?.error?.code}`);
  }
  return j.data as { status: string; fail_reason?: string };
}
