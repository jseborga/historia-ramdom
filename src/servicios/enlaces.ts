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
 *   - **Una conversación de Gemini compartida** (`share.gemini.google/…`,
 *     `g.co/gemini/share/…`, `gemini.google.com/share/…`): se lee la
 *     conversación con la misma llamada que hace la página y se bajan los
 *     vídeos generados, que Google sirve sin iniciar sesión. Si hay varios, se
 *     pregunta cuál.
 *
 * Los enlaces de Flow son páginas que piden sesión: se explica qué hacer.
 *
 * La descarga va con las mismas precauciones que Openverse: solo https, nada
 * que apunte a la red interna (comprobado en cada redirección) y con tope de
 * tamaño. Después, `guardarSubida` lo pasa por ffprobe: si no es un vídeo o
 * una foto de verdad, no se guarda.
 */

export type Descargado = { datos: Buffer; nombre: string };

/** Qué se espera: un vídeo, una imagen, o lo que venga (la Galería). */
export type Clase = "video" | "imagen" | "cualquiera";

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
export function interpretarEnlace(texto: string): { url: URL; origen: "drive" | "gemini" | "conversacion" | "directo" } {
  let u: URL;
  try {
    u = new URL(texto.trim());
  } catch {
    throw new Error("Eso no es un enlace");
  }
  const host = u.hostname.toLowerCase();

  if (esConversacionGemini(u)) return { url: u, origen: "conversacion" };
  if (host === "g.co" || host === "gemini.google.com" || host === "aistudio.google.com") {
    throw new Error(
      "Ese enlace de Gemini no es de una conversación compartida. En Gemini: «Compartir» → «Crear enlace público», " +
        "o descarga el vídeo y súbelo.",
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

function nombreDe(res: Response, url: URL, clase: Clase, tipo: string, base?: string): string {
  const cd = res.headers.get("content-disposition") ?? "";
  const deCabecera =
    /filename\*=UTF-8''([^;]+)/i.exec(cd)?.[1] ?? /filename="?([^";]+)"?/i.exec(cd)?.[1] ?? "";
  let nombre = "";
  try {
    nombre = decodeURIComponent(deCabecera);
  } catch {
    nombre = deCabecera;
  }
  if (base) nombre = base;
  if (!nombre) nombre = url.pathname.split("/").pop() ?? "";
  nombre = nombre.replace(/[^\p{L}\p{N} ._-]+/gu, "").slice(0, 100);
  // Sin extensión que valga, la del tipo que dijo el servidor, o la normal.
  if (!/\.(mp4|mov|m4v|webm|jpe?g|png|webp)$/i.test(nombre)) {
    nombre = `${nombre.replace(/\.[a-z0-9]+$/i, "") || "enlace"}${EXT_POR_TIPO[tipo] ?? (clase === "imagen" ? ".jpg" : ".mp4")}`;
  }
  return nombre;
}

/** Baja el archivo del enlace a memoria, con todas las comprobaciones. */
export async function descargarDeEnlace(texto: string, clase: Clase, indice?: number): Promise<Descargado> {
  const { url, origen } = interpretarEnlace(texto);
  if (origen !== "conversacion") return descargar(url, origen, clase);

  const { titulo, elementos } = await leerConversacionGemini(url);
  const validos = elementos.filter((e) => clase === "cualquiera" || e.tipo === clase);
  if (!validos.length) {
    throw new Error(
      elementos.length
        ? `Esa conversación no tiene ${clase === "video" ? "vídeos generados" : "imágenes generadas"}.`
        : "Esa conversación no tiene vídeos ni imágenes generados (o se compartió sin ellos).",
    );
  }
  let elegido = validos.length === 1 ? validos[0] : undefined;
  if (indice !== undefined) {
    elegido = validos.find((e) => e.indice === indice);
    if (!elegido) throw new Error("Esa opción ya no está en la conversación");
  }
  if (!elegido) {
    throw new VariasOpciones(
      `Esa conversación tiene ${validos.length} ${clase === "imagen" ? "imágenes" : "resultados"}: elige cuál.`,
      validos.map(({ indice, tipo, texto, fecha }) => ({ indice, tipo, texto, fecha })),
    );
  }
  const nombre = `${titulo || "Gemini"} ${elegido.indice + 1}`.replace(/[^\p{L}\p{N} ._-]+/gu, "").slice(0, 80);
  return descargar(new URL(elegido.url), "conversacion", elegido.tipo, nombre);
}

async function descargar(url: URL, origen: string, clase: Clase, base?: string): Promise<Descargado> {
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
      await res.body?.cancel().catch(() => {});
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
      if (origen === "conversacion") {
        throw new Error(`Google no dejó bajar ese resultado (${res.status}): puede que se haya borrado o dejado de compartir.`);
      }
      throw new Error(`No se pudo bajar (${res.status} desde ${actual.hostname})`);
    }

    const tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!TIPOS_BINARIOS.test(tipo)) {
      await res.body.cancel().catch(() => {});
      throw new Error(
        origen === "drive"
          ? "Drive devolvió una página en vez del archivo: compártelo como «Cualquier persona con el enlace»."
          : `Ese enlace lleva a una página (${tipo || "tipo desconocido"}), no a ${clase === "imagen" ? "una imagen" : "un vídeo"}.`,
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
    return { datos: Buffer.concat(trozos), nombre: nombreDe(res, url, clase, tipo, base) };
  }
  throw new Error("Demasiadas redirecciones");
}

// ---------------------------------------------------------------------------
// Conversaciones compartidas de Gemini
// ---------------------------------------------------------------------------

/** Lo que tiene que elegir quien pega una conversación con varios resultados. */
export type OpcionEnlace = { indice: number; tipo: "video" | "imagen"; texto: string; fecha: string | null };

export class VariasOpciones extends Error {
  constructor(
    mensaje: string,
    readonly opciones: OpcionEnlace[],
  ) {
    super(mensaje);
  }
}

type Elemento = OpcionEnlace & { url: string };

const HOSTS_CONVERSACION = new Set(["share.gemini.google", "g.co", "gemini.google.com"]);

function esConversacionGemini(u: URL) {
  const host = u.hostname.toLowerCase();
  if (host === "share.gemini.google") return /^\/[\w-]{6,40}\/?$/.test(u.pathname);
  if (host === "g.co") return /^\/gemini\/share\/[\w-]{6,40}\/?$/.test(u.pathname);
  if (host === "gemini.google.com") return /^\/share\/[\w-]{6,40}\/?$/.test(u.pathname);
  return false;
}

/**
 * El id de la conversación. Los enlaces cortos (`share.gemini.google/…`,
 * `g.co/…`) redirigen a `gemini.google.com/share/<id>`: se siguen sin salir de
 * los dominios de Gemini.
 */
async function idConversacion(u: URL): Promise<string> {
  let actual = u;
  for (let saltos = 0; saltos < 4; saltos++) {
    const directo = /^\/share\/([\w-]{6,40})\/?$/.exec(actual.pathname);
    if (actual.hostname === "gemini.google.com" && directo) return directo[1];
    if (actual.protocol !== "https:" || !HOSTS_CONVERSACION.has(actual.hostname)) {
      throw new Error("Ese enlace de Gemini lleva a otro sitio");
    }
    const res = await fetch(actual, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    await res.body?.cancel().catch(() => {});
    const siguiente = res.headers.get("location");
    if (!(res.status >= 300 && res.status < 400 && siguiente)) {
      throw new Error("Ese enlace de Gemini no lleva a ninguna conversación (¿se dejó de compartir?)");
    }
    actual = new URL(siguiente, actual);
  }
  throw new Error("Demasiadas redirecciones");
}

/**
 * Lee la conversación compartida con la misma llamada que hace su página
 * (`batchexecute`, `ujx1Bf`) y saca de cada respuesta los vídeos y las
 * imágenes generados, en el orden en que se hicieron.
 *
 * Es un formato interno de Google, no una API publicada: si cambia, esto deja
 * de encontrar resultados y el aviso lo dice; subir el archivo o pasar por
 * Drive sigue funcionando.
 */
export async function leerConversacionGemini(u: URL): Promise<{ titulo: string; elementos: Elemento[] }> {
  const id = await idConversacion(u);
  const cuerpo = new URLSearchParams({ "f.req": JSON.stringify([[["ujx1Bf", JSON.stringify([null, id]), null, "generic"]]]) });
  const res = await fetch("https://gemini.google.com/_/BardChatUi/data/batchexecute?rpcids=ujx1Bf&rt=c", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: cuerpo,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Gemini no devolvió la conversación (${res.status})`);
  const texto = await res.text();

  // Respuesta por trozos: una línea con la longitud y otra con el JSON.
  let datos: unknown = null;
  for (const linea of texto.split("\n")) {
    if (!linea.startsWith("[")) continue;
    try {
      const trozo = JSON.parse(linea) as unknown[][];
      const r = trozo.find((x) => Array.isArray(x) && x[0] === "wrb.fr" && x[1] === "ujx1Bf");
      if (r && typeof r[2] === "string") datos = JSON.parse(r[2]);
    } catch {
      // un trozo que no es el nuestro
    }
  }
  if (!Array.isArray(datos) || !Array.isArray(datos[0])) {
    throw new Error("Esa conversación no existe o ya no está compartida");
  }
  const raiz = datos[0] as unknown[];
  const titulo = typeof (raiz[2] as unknown[] | undefined)?.[1] === "string" ? String((raiz[2] as unknown[])[1]) : "";
  const turnos = Array.isArray(raiz[1]) ? (raiz[1] as unknown[][]) : [];

  const elementos: Elemento[] = [];
  for (const turno of turnos) {
    if (!Array.isArray(turno)) continue;
    const pedido = (turno[2] as unknown[][] | undefined)?.[0]?.[0];
    const segundos = (turno[4] as unknown[] | undefined)?.[0];
    const fecha = typeof segundos === "number" ? new Date(segundos * 1000).toISOString() : null;
    for (const r of resultados(turno[3])) {
      elementos.push({
        indice: elementos.length,
        tipo: r.tipo,
        url: r.url,
        texto: resumenDelPedido(typeof pedido === "string" ? pedido : ""),
        fecha,
      });
    }
  }
  return { titulo, elementos };
}

/**
 * Lo que distingue un pedido de otro. Los prompts de la app empiezan todos
 * igual (estilo, formato, fichas): lo que cambia es la acción, así que se
 * enseña la primera línea que no sea de esas.
 */
function resumenDelPedido(pedido: string): string {
  const comunes = /^(style|vertical|horizontal|characters?|camera|sound|no background|dialogue|-\s)/i;
  const lineas = pedido.split("\n").map((l) => l.trim()).filter(Boolean);
  const accion = lineas.find((l) => !comunes.test(l)) ?? lineas[0] ?? "";
  return accion.replace(/\s+/g, " ").slice(0, 160);
}

/**
 * Los archivos generados dentro de una respuesta: listas que llevan el tipo
 * ("video/mp4", "image/png"...) y, dentro, los enlaces de googleusercontent.
 * Para el vídeo, el que acaba en `=mm,…` es el del reproductor, el que baja
 * sin sesión; para una imagen, el original (`=s0`).
 */
function resultados(respuesta: unknown): { tipo: "video" | "imagen"; url: string }[] {
  const hallados: { tipo: "video" | "imagen"; url: string }[] = [];
  const vistos = new Set<string>();
  const recorrer = (x: unknown, prof: number) => {
    if (!Array.isArray(x) || prof > 40) return;
    const tipo = x.find((y): y is string => typeof y === "string" && /^(video|image)\/[\w.+-]+$/.test(y));
    const enlaces = x
      .filter(Array.isArray)
      .flat()
      .filter((y): y is string => typeof y === "string" && /^https:\/\/lh3\.googleusercontent\.com\//.test(y));
    if (tipo && enlaces.length) {
      const url = tipo.startsWith("video/")
        ? enlaces.find((e) => /=mm,[\d,]+$/.test(e))
        : `${enlaces.find((e) => !/=/.test(e.split("/").pop() ?? "")) ?? enlaces[0].replace(/=[^/]*$/, "")}=s0`;
      if (url && !vistos.has(url)) {
        vistos.add(url);
        hallados.push({ tipo: tipo.startsWith("video/") ? "video" : "imagen", url });
      }
      return;
    }
    for (const y of x) recorrer(y, prof + 1);
  };
  recorrer(respuesta, 0);
  return hallados;
}
