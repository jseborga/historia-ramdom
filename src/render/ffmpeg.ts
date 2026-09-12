import { spawn } from "node:child_process";

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
