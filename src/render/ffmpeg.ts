import { spawn } from "node:child_process";
import { open } from "node:fs/promises";

/**
 * Nunca se construye un comando de texto para la terminal: los argumentos van
 * como lista, con nombres de archivo generados por el codigo y tiempo maximo.
 */
export function ffmpeg(args: string[], cwd: string, timeoutMs = 15 * 60_000) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd });
    let errores = "";
    p.stderr.on("data", (d) => {
      errores = (errores + d).slice(-4000);
    });
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (err) => {
      clearTimeout(t);
      reject(new Error(`No se pudo ejecutar ffmpeg: ${err.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg termino con codigo ${code}: ${errores}`));
    });
  });
}

/** Comprueba que un archivo subido trae de verdad una pista de audio. */
export function tieneAudio(archivo: string) {
  return new Promise<boolean>((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error",
      "-select_streams", "a:0",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      archivo,
    ]);
    let salida = "";
    p.stdout.on("data", (d) => (salida += d));
    p.on("error", () => resolve(false));
    p.on("close", () => resolve(salida.trim() === "audio"));
  });
}

export function duracion(archivo: string, cwd: string) {
  return new Promise<number>((resolve, reject) => {
    const p = spawn(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", archivo],
      { cwd },
    );
    let salida = "";
    p.stdout.on("data", (d) => (salida += d));
    p.on("error", (err) => reject(new Error(`No se pudo ejecutar ffprobe: ${err.message}`)));
    p.on("close", (code) => {
      const s = Number(salida.trim());
      code === 0 && Number.isFinite(s)
        ? resolve(s)
        : reject(new Error(`ffprobe no pudo leer ${archivo}`));
    });
  });
}

/**
 * Duracion de un WAV leyendo su cabecera: recorre los chunks RIFF hasta
 * "fmt " y "data". Es lo que permite medir la voz local sin ffprobe.
 */
export async function duracionWav(ruta: string): Promise<number> {
  const fh = await open(ruta, "r");
  try {
    const cab = Buffer.alloc(12);
    await fh.read(cab, 0, 12, 0);
    if (cab.toString("ascii", 0, 4) !== "RIFF" || cab.toString("ascii", 8, 12) !== "WAVE") {
      throw new Error("No es un WAV");
    }
    let pos = 12;
    let byteRate = 0;
    const tam = (await fh.stat()).size;
    while (pos + 8 <= tam) {
      const h = Buffer.alloc(8);
      await fh.read(h, 0, 8, pos);
      const id = h.toString("ascii", 0, 4);
      const largo = h.readUInt32LE(4);
      if (id === "fmt ") {
        const f = Buffer.alloc(16);
        await fh.read(f, 0, 16, pos + 8);
        byteRate = f.readUInt32LE(8);
      } else if (id === "data") {
        if (!byteRate) throw new Error("WAV sin fmt");
        // Algunos escritores dejan el tamano a 0 o mal: se acota al archivo.
        const datos = largo && pos + 8 + largo <= tam ? largo : tam - pos - 8;
        return datos / byteRate;
      }
      pos += 8 + largo + (largo % 2);
    }
    throw new Error("WAV sin chunk data");
  } finally {
    await fh.close();
  }
}

/** ffprobe si esta; si no (o si falla), la cabecera WAV. */
export async function duracionAudio(ruta: string): Promise<number> {
  try {
    return await duracion(ruta, process.cwd());
  } catch {
    return duracionWav(ruta);
  }
}
