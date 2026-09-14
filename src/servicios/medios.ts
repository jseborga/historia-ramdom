import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { stat, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { ClaseMedio } from "@prisma/client";
import { db } from "../db.js";
import { rutaMedios, rutaMedioSeguro, rutaMiniaturas } from "../almacen.js";
import { ffmpeg } from "../render/ffmpeg.js";
import { descargarDeClip, type ClipInfo } from "./clips.js";

/**
 * La biblioteca: vídeo y foto propios o guardados de los bancos, para
 * componer vídeos sin volver a buscar cada vez.
 *
 * Todo lo que entra pasa por el mismo filtro: extensión conocida, nombre
 * generado aquí (nunca el del navegador) y ffprobe de verdad, que es lo único
 * que demuestra que un archivo es lo que dice ser.
 */

export const EXT_VIDEO = /\.(mp4|mov|m4v|webm)$/i;
export const EXT_IMAGEN = /\.(jpe?g|png|webp)$/i;

/** Lo que ffprobe saca de un archivo: sin esto no se guarda. */
export type InfoMedio = { clase: ClaseMedio; duracion: number | null; ancho: number; alto: number };

function ffprobe(args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "error", ...args]);
    let salida = "";
    p.stdout.on("data", (d) => (salida += d));
    p.on("error", (err) => reject(new Error(`No se pudo ejecutar ffprobe: ${err.message}`)));
    p.on("close", (code) => (code === 0 ? resolve(salida.trim()) : reject(new Error("ffprobe no pudo leer el archivo"))));
  });
}

/**
 * Qué es de verdad el archivo. Una foto y un vídeo se distinguen por la
 * duración y por el codec: un PNG también trae un "stream de vídeo" de un
 * fotograma, así que el criterio es el número de fotogramas.
 */
export async function analizarMedio(ruta: string): Promise<InfoMedio> {
  const crudo = await ffprobe([
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,nb_frames,codec_name:format=duration",
    "-of", "default=noprint_wrappers=1",
    ruta,
  ]);
  const leer = (clave: string) => {
    const linea = crudo.split("\n").find((l) => l.startsWith(`${clave}=`));
    const valor = linea?.split("=")[1]?.trim();
    return valor && valor !== "N/A" ? valor : null;
  };
  const ancho = Number(leer("width") ?? 0);
  const alto = Number(leer("height") ?? 0);
  if (!ancho || !alto) throw new Error("El archivo no contiene imagen");

  const codec = leer("codec_name") ?? "";
  const fotogramas = Number(leer("nb_frames") ?? 0);
  const duracion = Number(leer("duration") ?? 0);
  const esFoto = ["mjpeg", "png", "webp", "bmp", "gif"].includes(codec) && fotogramas <= 1;

  return {
    clase: esFoto ? "IMAGEN" : "VIDEO",
    duracion: esFoto || !Number.isFinite(duracion) || duracion <= 0 ? null : duracion,
    ancho,
    alto,
  };
}

/** Nombre de archivo de la biblioteca: lo pone el servidor, siempre. */
const nombreArchivo = (extension: string) => `${randomUUID()}.${extension.toLowerCase()}`;

const extensionDe = (nombre: string) => (/\.([a-z0-9]+)$/i.exec(nombre)?.[1] ?? "").toLowerCase();

export type Guardado = { ok: true; medio: Awaited<ReturnType<typeof crearFila>> } | { ok: false; mensaje: string };

function crearFila(datos: {
  clase: ClaseMedio;
  archivo: string;
  nombre: string;
  fuente: string;
  autor?: string | null;
  pagina?: string | null;
  licencia?: string | null;
  externoId?: string | null;
  duracion?: number | null;
  ancho?: number | null;
  alto?: number | null;
  bytes?: number | null;
  etiquetas?: string[];
}) {
  return db.medio.create({ data: { ...datos, etiquetas: datos.etiquetas ?? [] } });
}

/**
 * Guarda un archivo que sube el usuario. El nombre visible se queda con el
 * suyo (para reconocerlo en la rejilla), pero el del disco lo pone el
 * servidor.
 */
export async function guardarSubida(datos: Buffer, nombreOriginal: string, etiquetas: string[] = []): Promise<Guardado> {
  const esVideo = EXT_VIDEO.test(nombreOriginal);
  const esImagen = EXT_IMAGEN.test(nombreOriginal);
  if (!esVideo && !esImagen) {
    return { ok: false, mensaje: "Formato no admitido: usa mp4, mov, m4v, webm, jpg, png o webp" };
  }

  const archivo = nombreArchivo(extensionDe(nombreOriginal));
  const destino = rutaMedioSeguro(archivo);
  await writeFile(destino, datos);

  let info: InfoMedio;
  try {
    info = await analizarMedio(destino);
  } catch {
    await unlink(destino).catch(() => {});
    return { ok: false, mensaje: "El archivo no es un vídeo ni una foto que se pueda usar" };
  }

  const medio = await crearFila({
    clase: info.clase,
    archivo,
    nombre: basename(nombreOriginal).replace(/\.[a-z0-9]+$/i, "").slice(0, 120) || "Sin nombre",
    fuente: "subido",
    duracion: info.duracion,
    ancho: info.ancho,
    alto: info.alto,
    bytes: datos.length,
    etiquetas,
  });
  return { ok: true, medio };
}

/**
 * Guarda en la biblioteca algo encontrado en un banco. El enlace no llega del
 * navegador: viene de la búsqueda del servidor, que ya pasó por la lista de
 * dominios permitidos.
 */
export async function guardarDeBanco(clip: ClipInfo, etiquetas: string[] = []): Promise<Guardado> {
  const ya = await db.medio.findFirst({ where: { externoId: clip.id } });
  if (ya) return { ok: true, medio: ya };

  const extension = extensionDe(new URL(clip.url).pathname) || (clip.tipo === "imagen" ? "jpg" : "mp4");
  const archivo = nombreArchivo(extension);
  const destino = rutaMedioSeguro(archivo);
  await descargarDeClip(clip, destino);

  let info: InfoMedio;
  try {
    info = await analizarMedio(destino);
  } catch {
    await unlink(destino).catch(() => {});
    return { ok: false, mensaje: "Lo descargado no se pudo leer como vídeo ni como foto" };
  }
  const tam = await stat(destino).catch(() => null);

  const medio = await crearFila({
    clase: info.clase,
    archivo,
    nombre: `${clip.autor} · ${clip.fuente}`.slice(0, 120),
    fuente: clip.fuente,
    autor: clip.autor,
    pagina: clip.pagina,
    licencia: clip.licencia,
    externoId: clip.id,
    duracion: info.duracion ?? clip.duracion ?? null,
    ancho: info.ancho,
    alto: info.alto,
    bytes: tam?.size ?? null,
    etiquetas,
  });
  return { ok: true, medio };
}

export type MedioFila = {
  id: string;
  clase: ClaseMedio;
  archivo: string;
  nombre: string;
  fuente: string;
  autor: string | null;
  pagina: string | null;
  licencia: string | null;
  duracion: number | null;
  ancho: number | null;
  alto: number | null;
};

/**
 * Un medio de la biblioteca convertido en clip de la línea de tiempo. Lleva
 * `archivo`: el render lo lee del disco en vez de descargar nada, y la URL
 * solo sirve para verlo en el editor.
 */
export function clipDeMedio(m: MedioFila): ClipInfo & { archivo: string } {
  return {
    id: `medio-${m.id}`,
    fuente: (m.fuente === "subido" ? "subido" : m.fuente) as ClipInfo["fuente"],
    tipo: m.clase === "IMAGEN" ? "imagen" : "video",
    autor: m.autor ?? m.nombre,
    pagina: m.pagina ?? "",
    licencia: m.licencia ?? "Material propio",
    url: `/api/medios/${m.id}/ver`,
    archivo: m.archivo,
    imagen: `/api/medios/${m.id}/miniatura`,
    duracion: m.duracion ?? undefined,
  };
}

/** Ruta de la miniatura; se genera la primera vez que se pide. */
export async function miniaturaDe(m: MedioFila): Promise<string> {
  const destino = join(rutaMiniaturas(), `${m.id}.jpg`);
  if (await stat(destino).then((x) => x.size > 0, () => false)) return destino;

  const origen = rutaMedioSeguro(m.archivo);
  const escala = "scale=480:-2";
  await ffmpeg(
    m.clase === "IMAGEN"
      ? ["-i", origen, "-vf", escala, "-frames:v", "1", destino]
      : // Un segundo dentro: el primer fotograma de muchos vídeos es negro.
        ["-ss", "1", "-i", origen, "-vf", escala, "-frames:v", "1", destino],
    rutaMedios(),
  );
  return destino;
}

export async function borrarMedio(id: string) {
  const m = await db.medio.findUnique({ where: { id } });
  if (!m) return false;
  await db.medio.delete({ where: { id } });
  await unlink(rutaMedioSeguro(m.archivo)).catch(() => {});
  await unlink(join(rutaMiniaturas(), `${m.id}.jpg`)).catch(() => {});
  return true;
}
