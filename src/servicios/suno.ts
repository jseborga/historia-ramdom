import { createWriteStream } from "node:fs";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { rutaMusica, rutaMusicaSegura, crearCarpetaProyecto } from "../almacen.js";
import { tieneAudio, duracionAudio } from "../render/ffmpeg.js";
import { mkdir } from "node:fs/promises";

/**
 * Música de ambiente desde un enlace de Suno.
 *
 * Solo se aceptan enlaces de Suno y solo se descarga desde su CDN: el
 * identificador de la canción se saca del enlace y la dirección de descarga
 * la arma el código, así que nunca se sigue una URL arbitraria (SSRF).
 *
 * El archivo se guarda como `suno-<id>.mp3`; de ese nombre salen después los
 * créditos ("Música: Suno — https://suno.com/song/<id>").
 */

const HOSTS_SUNO = new Set(["suno.com", "www.suno.com", "app.suno.ai", "suno.ai", "www.suno.ai"]);
const CDN_SUNO = "cdn1.suno.ai";
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** 40 MB: una canción de Suno pesa entre 3 y 8 MB. */
const MAX_BYTES = 40 * 1024 * 1024;

export const esNombreSuno = (nombre: string | null | undefined) =>
  Boolean(nombre && /^suno-[0-9a-f-]{36}\.mp3$/i.test(nombre));

/** Enlace público de la canción a partir del nombre de archivo guardado. */
export function enlaceSuno(nombre: string): string | null {
  const id = /^suno-([0-9a-f-]{36})\.mp3$/i.exec(nombre)?.[1];
  return id ? `https://suno.com/song/${id}` : null;
}

/** Línea de crédito para la descripción; null si la pista no es de Suno. */
export function creditoMusica(nombre: string | null | undefined): string | null {
  if (!nombre) return null;
  const enlace = enlaceSuno(nombre);
  if (enlace) return `Música: Suno — ${enlace}`;
  return null;
}

/**
 * Saca el id de la canción del enlace. Acepta suno.com/song/<id>,
 * app.suno.ai/song/<id>, cdn1.suno.ai/<id>.mp3 y los enlaces cortos
 * suno.com/s/<código>, que se resuelven pidiendo la página a Suno.
 */
export async function resolverIdSuno(enlace: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(enlace.trim());
  } catch {
    throw new Error("El enlace de Suno no es una dirección válida");
  }
  if (url.protocol !== "https:" || (!HOSTS_SUNO.has(url.hostname) && url.hostname !== CDN_SUNO)) {
    throw new Error("Solo se aceptan enlaces de suno.com (por ejemplo https://suno.com/song/...)");
  }
  const directo = UUID.exec(url.pathname)?.[0];
  if (directo) return directo.toLowerCase();

  // Enlace corto: la página (o su redirección) contiene el id largo.
  if (!/^\/s\/[\w-]{4,40}$/.test(url.pathname)) {
    throw new Error("No se reconoce el enlace: usa el de la canción (suno.com/song/...)");
  }
  const res = await fetch(url, {
    redirect: "manual",
    headers: { "User-Agent": "Mozilla/5.0 (estudio-voz-en-off)" },
    signal: AbortSignal.timeout(20_000),
  });
  const destino = res.headers.get("location");
  const enRedir = destino ? UUID.exec(destino)?.[0] : null;
  if (enRedir) return enRedir.toLowerCase();
  const html = (await res.text().catch(() => "")).slice(0, 2_000_000);
  const enPagina = /\/song\/([0-9a-f-]{36})/i.exec(html)?.[1] ?? /cdn1\.suno\.ai\/([0-9a-f-]{36})/i.exec(html)?.[1];
  if (!enPagina) throw new Error("Suno no devolvió la canción de ese enlace corto; abre la canción y copia su enlace largo");
  return enPagina.toLowerCase();
}

async function descargarDesdeCDN(id: string, destino: string) {
  const url = `https://${CDN_SUNO}/${id}.mp3`;
  const res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(90_000) });
  if (res.status === 403 || res.status === 404) {
    throw new Error(
      "Suno no dejó descargar esa canción (¿es privada o ya no existe?). " +
        "Ábrela en Suno, descárgala y súbela aquí como archivo.",
    );
  }
  if (!res.ok || !res.body) throw new Error(`La descarga desde Suno falló (${res.status})`);
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("La canción supera los 40 MB");

  let bytes = 0;
  const limite = new Transform({
    transform(trozo, _enc, cb) {
      bytes += trozo.length;
      bytes > MAX_BYTES ? cb(new Error("La canción supera los 40 MB")) : cb(null, trozo);
    },
  });
  await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), limite, createWriteStream(destino));
}

/** Comprueba con ffprobe que lo bajado es audio de verdad; si no, lo borra. */
async function validar(destino: string) {
  if (!(await tieneAudio(destino))) {
    await unlink(destino).catch(() => {});
    throw new Error("Lo que devolvió Suno no es un archivo de audio");
  }
  return duracionAudio(destino).catch(() => null);
}

/**
 * Descarga la canción a la biblioteca compartida (DATA_DIR/musica), donde la
 * ven las series, las historias sueltas y el editor. Si ya estaba, no la baja
 * otra vez.
 */
export async function importarSunoABiblioteca(enlace: string) {
  const id = await resolverIdSuno(enlace);
  const nombre = `suno-${id}.mp3`;
  await mkdir(rutaMusica(), { recursive: true });
  const destino = rutaMusicaSegura(nombre);
  const existente = await duracionAudio(destino).catch(() => null);
  if (existente) return { archivo: nombre, duracion: existente, enlace: enlaceSuno(nombre)!, nueva: false };

  await descargarDesdeCDN(id, destino);
  const duracion = await validar(destino);
  return { archivo: nombre, duracion, enlace: enlaceSuno(nombre)!, nueva: true };
}

/** Descarga la canción dentro de la carpeta de un proyecto del editor. */
export async function importarSunoAProyecto(proyectoId: string, enlace: string) {
  const id = await resolverIdSuno(enlace);
  const nombre = `suno-${id}.mp3`;
  const dir = await crearCarpetaProyecto(proyectoId);
  const destino = join(dir, nombre);
  const existente = await duracionAudio(destino).catch(() => null);
  if (existente) return { archivo: nombre, duracion: existente, enlace: enlaceSuno(nombre)! };

  await descargarDesdeCDN(id, destino);
  const duracion = await validar(destino);
  return { archivo: nombre, duracion, enlace: enlaceSuno(nombre)! };
}
