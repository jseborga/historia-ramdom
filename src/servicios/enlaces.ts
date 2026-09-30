import { env, MAX_CLIP_BYTES } from "../env.js";
import { destinoAdmitido } from "./clips.js";

/**
 * Traer un vídeo o una foto desde un enlace en vez de subir el archivo: lo que
 * sale de Veo casi nunca está en el ordenador desde el que se usa la app (se
 * genera en el móvil, se guarda en Drive, o la API de Gemini deja un enlace).
 *
 * Qué enlaces sirven:
 *   - **Google Drive** compartido como «cualquier persona con el enlace»
 *     (`drive.google.com/file/d/…`, `…/open?id=…`, `…/uc?id=…`): se baja por
 *     la descarga directa de Drive.
 *   - **El archivo de la API de Gemini** que deja una generación de Veo
 *     (`generativelanguage.googleapis.com/…/files/…`): se baja con la clave
 *     de Gemini del servidor, que solo viaja a ese dominio.
 *   - **Un enlace directo** a un .mp4, .mov, .webm, .jpg, .png o .webp.
 *
 * Los enlaces de conversación de Gemini (`g.co/gemini/share/…`) y los de Flow
 * son páginas, no archivos: se explica qué hacer en vez de intentarlo.
 *
 * La descarga va con las mismas precauciones que Openverse: solo https, nada
 * que apunte a la red interna (comprobado en cada redirección) y con tope de
 * tamaño. Después, `guardarSubida` lo pasa por ffprobe: si no es un vídeo o
 * una foto de verdad, no se guarda.
 */

export type Descargado = { datos: Buffer; nombre: string };

const HOST_GEMINI_API = "generativelanguage.googleapis.com";

/** Tipos que se aceptan tal cual; lo genérico se deja a ffprobe. */
const TIPOS_BINARIOS = /^(video\/|image\/|application\/octet-stream$|binary\/octet-stream$|application\/binary$)/;

const EXT_POR_TIPO: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-m4v": ".m4v",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/** Lo que dice el enlace que es, antes de bajar nada. */
export function interpretarEnlace(texto: string): { url: URL; origen: "drive" | "gemini" | "directo" } {
  let u: URL;
  try {
    u = new URL(texto.trim());
  } catch {
    throw new Error("Eso no es un enlace");
  }
  const host = u.hostname.toLowerCase();

  if (host === "g.co" || host === "gemini.google.com" || host === "aistudio.google.com") {
    throw new Error(
      "Ese es el enlace de la conversación, no del vídeo. En Gemini, descarga el vídeo y súbelo, " +
        "o guárdalo en Google Drive y pega aquí el enlace de Drive.",
    );
  }
  if (host === "labs.google" || host.endsWith(".labs.google")) {
    throw new Error(
      "Los enlaces de Flow son páginas, no el archivo. Descarga el vídeo desde Flow y súbelo, " +
        "o guárdalo en Google Drive y pega aquí el enlace de Drive.",
    );
  }

  if (host === "drive.google.com" || host === "docs.google.com" || host === "drive.usercontent.google.com") {
    const id = /\/d\/([\w-]{10,})/.exec(u.pathname)?.[1] ?? u.searchParams.get("id");
    if (!id || !/^[\w-]{10,200}$/.test(id)) {
      throw new Error("No encuentro el archivo en ese enlace de Drive: usa «Compartir → Copiar enlace» del archivo, no de la carpeta.");
    }
    // confirm=t se salta el aviso de «no se pudo analizar en busca de virus»
    // que Drive pone a los archivos grandes.
    const directo = new URL("https://drive.usercontent.google.com/download");
    directo.search = new URLSearchParams({ id, export: "download", confirm: "t" }).toString();
    return { url: directo, origen: "drive" };
  }

  if (host === HOST_GEMINI_API) {
    // files/abc o files/abc:download: siempre la descarga del contenido.
    const archivo = /\/files\/([\w-]+)/.exec(u.pathname)?.[1];
    if (!archivo) throw new Error("Ese enlace de la API de Gemini no es de un archivo");
    if (!env.GEMINI_API_KEY) throw new Error("Para bajar de la API de Gemini hace falta GEMINI_API_KEY en el servidor");
    const directo = new URL(`https://${HOST_GEMINI_API}/v1beta/files/${archivo}:download`);
    directo.searchParams.set("alt", "media");
    return { url: directo, origen: "gemini" };
  }

  return { url: u, origen: "directo" };
}

function nombreDe(res: Response, url: URL, clase: "video" | "imagen", tipo: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const deCabecera =
    /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? "";
  let nombre = "";
  try {
    nombre = decodeURIComponent(deCabecera);
  } catch {
    nombre = deCabecera;
  }
  if (!nombre) nombre = url.pathname.split("/").pop() ?? "";
  nombre = nombre.replace(/[^\p{L}\p{N} ._-]+/gu, "").slice(0, 100);
  // Sin extensión que valga, la del tipo que dijo el servidor, o la normal.
  if (!/\.(mp4|mov|m4v|webm|jpe?g|png|webp)$/i.test(nombre)) {
    nombre = `${nombre.replace(/\.[a-z0-9]+$/i, "") || "enlace"}${EXT_POR_TIPO[tipo] ?? (clase === "video" ? ".mp4" : ".jpg")}`;
  }
  return nombre;
}

/** Baja el archivo del enlace a memoria, con todas las comprobaciones. */
export async function descargarDeEnlace(texto: string, clase: "video" | "imagen"): Promise<Descargado> {
  const { url, origen } = interpretarEnlace(texto);
  let actual = url;
  for (let saltos = 0; saltos < 6; saltos++) {
    await destinoAdmitido(actual, true);
    // La clave de Gemini solo a su dominio: si la API redirige a otro sitio,
    // la siguiente petición ya va sin ella.
    const cabeceras: Record<string, string> = { "User-Agent": "estudio-voz-en-off/1.0" };
    if (origen === "gemini" && actual.hostname === HOST_GEMINI_API) cabeceras["x-goog-api-key"] = env.GEMINI_API_KEY!;
    const res = await fetch(actual, { redirect: "manual", headers: cabeceras, signal: AbortSignal.timeout(120_000) });
    const siguiente = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && siguiente) {
      actual = new URL(siguiente, actual);
      continue;
    }
    if (!res.ok || !res.body) {
      await res.body?.cancel().catch(() => {});
      if (origen === "drive" && (res.status === 403 || res.status === 404)) {
        throw new Error("Drive no deja bajarlo: compártelo como «Cualquier persona con el enlace».");
      }
      if (origen === "gemini" && (res.status === 403 || res.status === 404)) {
        throw new Error("La API de Gemini no lo encuentra: los vídeos de Veo se borran a los 2 días, o es de otra cuenta.");
      }
      throw new Error(`No se pudo bajar (${res.status} desde ${actual.hostname})`);
    }

    const tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TIPOS_BINARIOS.test(tipo)) {
      await res.body.cancel().catch(() => {});
      throw new Error(
        origen === "drive"
          ? "Drive devolvió una página en vez del archivo: compártelo como «Cualquier persona con el enlace»."
          : `Ese enlace lleva a una página (${tipo || "tipo desconocido"}), no a un ${clase === "video" ? "vídeo" : "archivo de imagen"}.`,
      );
    }
    if (Number(res.headers.get("content-length") ?? 0) > MAX_CLIP_BYTES) {
      await res.body.cancel().catch(() => {});
      throw new Error(`El archivo supera los ${env.MAX_CLIP_MB} MB`);
    }

    const trozos: Buffer[] = [];
    let bytes = 0;
    const lector = res.body.getReader();
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_CLIP_BYTES) {
        await lector.cancel().catch(() => {});
        throw new Error(`El archivo supera los ${env.MAX_CLIP_MB} MB`);
      }
      trozos.push(Buffer.from(value));
    }
    if (!bytes) throw new Error("El enlace no trae nada");
    return { datos: Buffer.concat(trozos), nombre: nombreDe(res, url, clase, tipo) };
  }
  throw new Error("Demasiadas redirecciones");
}
