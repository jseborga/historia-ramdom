import { mkdir, rm, rename, copyFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { env, DIR_VIDEOS, DIR_TRABAJO, DIR_MUSICA } from "./env.js";

export const rutaVideos = () => join(env.DATA_DIR, DIR_VIDEOS);
export const rutaTrabajo = () => join(env.DATA_DIR, DIR_TRABAJO);
export const rutaMusica = () => join(env.DATA_DIR, DIR_MUSICA);

/** La ruta del MP4 siempre se arma con el ID de la base de datos. */
export const rutaVideo = (id: string) => join(rutaVideos(), `${id}.mp4`);

export async function prepararCarpetas() {
  await mkdir(rutaVideos(), { recursive: true });
  await mkdir(rutaTrabajo(), { recursive: true });
  await mkdir(rutaMusica(), { recursive: true });
}

export async function crearCarpetaTrabajo(id: string) {
  const dir = join(rutaTrabajo(), id);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function borrarCarpetaTemporal(dir: string) {
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}

/** Mueve el render terminado al almacen definitivo y devuelve el nombre final. */
export async function moverAVideos(archivo: string, id: string) {
  await mkdir(rutaVideos(), { recursive: true });
  const destino = rutaVideo(id);
  try {
    await rename(archivo, destino);
  } catch {
    // rename falla si origen y destino estan en sistemas de archivos distintos
    await copyFile(archivo, destino);
  }
  return `${id}.mp4`;
}

/** Musica de fondo disponible en DATA_DIR/musica (solo con licencia libre). */
export async function listarMusica() {
  const archivos = await readdir(rutaMusica()).catch(() => [] as string[]);
  return archivos.filter((f) => /\.(mp3|m4a|wav|ogg)$/i.test(f));
}

/**
 * Elige la pista menos usada recientemente, para que la musica no se repita
 * historia tras historia. `usadas` viene de las ultimas historias de la serie.
 */
export async function elegirMusicaRotativa(usadas: (string | null)[] = []) {
  const pistas = await listarMusica();
  if (!pistas.length) return null;
  const recientes = usadas.filter(Boolean) as string[];
  const frescas = pistas.filter((p) => !recientes.includes(p));
  const candidatas = frescas.length ? frescas : pistas;
  return candidatas[Math.floor(Math.random() * candidatas.length)];
}

export function rutaMusicaSegura(nombre: string) {
  if (!/^[\w .-]+$/.test(nombre) || nombre.includes("..")) {
    throw new Error("Nombre de musica invalido");
  }
  return join(rutaMusica(), nombre);
}

/** Borra carpetas de trabajo huerfanas y videos mas viejos que la retencion. */
export async function limpiarDisco(retencionDias = env.RETENCION_DIAS) {
  const ahora = Date.now();
  const borrados: string[] = [];

  for (const nombre of await readdir(rutaTrabajo()).catch(() => [] as string[])) {
    const dir = join(rutaTrabajo(), nombre);
    const info = await stat(dir).catch(() => null);
    if (info && ahora - info.mtimeMs > 864e5) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  for (const nombre of await readdir(rutaVideos()).catch(() => [] as string[])) {
    const archivo = join(rutaVideos(), nombre);
    const info = await stat(archivo).catch(() => null);
    if (info && ahora - info.mtimeMs > retencionDias * 864e5) {
      await rm(archivo, { force: true }).catch(() => {});
      borrados.push(nombre.replace(/\.mp4$/, ""));
    }
  }

  return borrados;
}
