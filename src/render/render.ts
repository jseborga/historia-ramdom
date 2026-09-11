import { stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env, MAX_VIDEO_BYTES, MB } from "../env.js";
import { ffmpeg, duracion } from "./ffmpeg.js";
import { crearASS, type Tramo } from "./subtitulos.js";

const VF =
  "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p";
const PAUSA = 0.4;

/** Carpeta de fuentes que libass usa al quemar los subtitulos. */
const FONTS_DIR = resolve(process.cwd(), "fonts");
/** En un filtro de ffmpeg hay que escapar \ : ' y , */
const escapar = (v: string) => v.replace(/([\\:'])/g, "\\$1");

export type EscenaRender = {
  texto: string;
  /** nombre del clip dentro de `dir` */
  archivo: string;
  /** nombre del audio dentro de `dir` */
  audio: string;
};

export async function renderizar(dir: string, escenas: EscenaRender[], musica?: string) {
  if (!escenas.length) throw new Error("No hay escenas que renderizar");

  const videos: string[] = [];
  const audios: string[] = [];
  const tramos: Tramo[] = [];
  let t = 0;

  for (const [i, e] of escenas.entries()) {
    // 1. Audio normalizado con la pausa al final
    const a = `a${i}.wav`;
    await ffmpeg(["-i", e.audio, "-af", `apad=pad_dur=${PAUSA}`, "-ar", "48000", "-ac", "2", a], dir);
    const d = await duracion(a, dir);

    // 2. Clip vertical con la duracion exacta del audio
    const v = `v${i}.mp4`;
    await ffmpeg(
      [
        "-stream_loop", "-1",
        "-i", e.archivo,
        "-t", d.toFixed(3),
        "-vf", VF,
        "-an",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        v,
      ],
      dir,
    );

    videos.push(v);
    audios.push(a);
    tramos.push({ inicio: t, fin: t + d - PAUSA, texto: e.texto });
    t += d;
  }

  // 3. Unir partes (todas tienen el mismo formato, asi que no se recodifican)
  await writeFile(join(dir, "videos.txt"), videos.map((f) => `file '${f}'`).join("\n"));
  await writeFile(join(dir, "audios.txt"), audios.map((f) => `file '${f}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "videos.txt", "-c", "copy", "video.mp4"], dir);
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "audios.txt", "-c", "copy", "voz.wav"], dir);
  await writeFile(join(dir, "subs.ass"), crearASS(tramos));

  // 4. Mezcla final: subtitulos, voz, musica con ducking y volumen para redes
  const args = ["-i", "video.mp4", "-i", "voz.wav"];
  let filtro = `[0:v]subtitles=subs.ass:fontsdir=${escapar(FONTS_DIR)}[v];`;
  if (musica) {
    args.push("-stream_loop", "-1", "-i", musica);
    filtro +=
      "[2:a]volume=0.25[m];[1:a]asplit=2[vz][sc];" +
      "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck];" +
      "[vz][duck]amix=inputs=2:duration=first:normalize=0[mix];";
  } else {
    filtro += "[1:a]anull[mix];";
  }
  filtro += "[mix]loudnorm=I=-14:TP=-1.5:LRA=11[a]";

  args.push(
    "-filter_complex", filtro,
    "-map", "[v]",
    "-map", "[a]",
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "20",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-ar", "48000",
    "-movflags", "+faststart",
    "-t", t.toFixed(3),
    "final.mp4",
  );
  await ffmpeg(args, dir);

  // El MP4 compilado no puede pasar del limite configurado (MAX_VIDEO_MB).
  const archivo = join(dir, "final.mp4");
  const { size } = await stat(archivo);
  if (size > MAX_VIDEO_BYTES) {
    throw new Error(
      `El video compilado pesa ${(size / MB).toFixed(1)} MB y supera el limite de ` +
        `${env.MAX_VIDEO_MB} MB (MAX_VIDEO_MB). Sube el limite o acorta la duracion.`,
    );
  }

  return { archivo, duracion: t, bytes: size };
}
