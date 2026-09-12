import { spawn } from "node:child_process";
import { open, readFile, writeFile } from "node:fs/promises";

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

type Wav = { rate: number; canales: number; bits: number; datos: Buffer };

async function leerWav(ruta: string): Promise<Wav> {
  const b = await readFile(ruta);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") throw new Error("No es un WAV");
  let pos = 12;
  let fmt: { rate: number; canales: number; bits: number } | null = null;
  while (pos + 8 <= b.length) {
    const id = b.toString("ascii", pos, pos + 4);
    const largo = b.readUInt32LE(pos + 4);
    if (id === "fmt ") fmt = { canales: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    if (id === "data") {
      if (!fmt) throw new Error("WAV sin fmt");
      const fin = largo && pos + 8 + largo <= b.length ? pos + 8 + largo : b.length;
      return { ...fmt, datos: b.subarray(pos + 8, fin) };
    }
    pos += 8 + largo + (largo % 2);
  }
  throw new Error("WAV sin data");
}

/**
 * Pega varios WAV del mismo formato, con un silencio entre ellos, sin ffmpeg.
 * Es lo que permite montar la narracion frase a frase con la voz local y
 * saber donde empieza cada frase. Devuelve el inicio de cada trozo.
 */
export async function concatenarWav(rutas: string[], destino: string, silencioSeg = 0.25) {
  const wavs = await Promise.all(rutas.map(leerWav));
  const { rate, canales, bits } = wavs[0];
  if (wavs.some((w) => w.rate !== rate || w.canales !== canales || w.bits !== bits)) {
    throw new Error("Los WAV no tienen el mismo formato");
  }
  const bytesPorSeg = rate * canales * (bits / 8);
  const silencio = Buffer.alloc(Math.round(silencioSeg * bytesPorSeg) & ~((canales * bits) / 8 - 1));
  const inicios: number[] = [];
  const partes: Buffer[] = [];
  let pos = 0;
  for (const [i, w] of wavs.entries()) {
    inicios.push(pos / bytesPorSeg);
    partes.push(w.datos);
    pos += w.datos.length;
    if (i < wavs.length - 1) {
      partes.push(silencio);
      pos += silencio.length;
    }
  }
  const datos = Buffer.concat(partes);
  const cab = Buffer.alloc(44);
  cab.write("RIFF", 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write("WAVE", 8);
  cab.write("fmt ", 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(canales, 22);
  cab.writeUInt32LE(rate, 24); cab.writeUInt32LE(bytesPorSeg, 28); cab.writeUInt16LE(canales * (bits / 8), 32); cab.writeUInt16LE(bits, 34);
  cab.write("data", 36); cab.writeUInt32LE(datos.length, 40);
  await writeFile(destino, Buffer.concat([cab, datos]));
  return { inicios, duraciones: wavs.map((w) => w.datos.length / bytesPorSeg), total: datos.length / bytesPorSeg };
}
