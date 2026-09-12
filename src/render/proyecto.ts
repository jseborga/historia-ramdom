import { stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env, MAX_VIDEO_BYTES, MB } from "../env.js";
import { ffmpeg } from "./ffmpeg.js";
import { buscarPreset, filtroEscena, type Preset } from "./presets.js";
import { crearASSProyecto, type Rotulo } from "./rotulos.js";
import { descargarClip } from "../servicios/clips.js";
import {
  duracionVideo,
  duracionProyecto,
  type ClipPista,
  type MusicaCapa,
  type RotuloPista,
  type VozPista,
} from "../servicios/proyecto.js";

const FONTS_DIR = resolve(process.cwd(), "fonts");
const escapar = (v: string) => v.replace(/([\\:'])/g, "\\$1");

export type EntradaRender = {
  formato: string;
  video: ClipPista[];
  textos: RotuloPista[];
  voz: VozPista;
  musica: MusicaCapa;
  /** Ruta absoluta de la narracion (generada o subida), si la hay. */
  rutaVoz?: string;
  /** Ruta absoluta de la pista de musica, si la hay. */
  rutaMusica?: string;
};

/**
 * Renderiza las tres pistas a un unico MP4. Cada una se construye por su
 * lado —imagen, rotulos, voz— y solo se juntan al final. Si la voz o los
 * textos duran mas que los clips, el ultimo fotograma se congela: nada se corta.
 */
export async function renderizarProyecto(dir: string, e: EntradaRender) {
  const preset = buscarPreset(e.formato);
  const conVoz = e.voz.modo !== "ninguna" && Boolean(e.rutaVoz);
  const total = Math.max(
    duracionProyecto({ video: e.video, textos: e.textos, voz: conVoz ? e.voz : { ...e.voz, modo: "ninguna" } }),
    0.5,
  );
  const tVideo = duracionVideo(e.video);

  // 1. Pista de video: cada clip con su recorte, duracion y efecto
  const partes: string[] = [];
  for (const [i, c] of e.video.entries()) {
    const v = `v${i}.mp4`;
    const vf = filtroEscena(preset, c.efecto, c.duracion);
    if (c.clip) {
      const origen = `c${i}.mp4`;
      await descargarClip(c.clip.url, join(dir, origen));
      await ffmpeg(
        ["-stream_loop", "-1", "-i", origen, "-ss", c.recorte.toFixed(3), "-t", c.duracion.toFixed(3),
         "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v],
        dir,
      );
    } else {
      await ffmpeg(
        ["-f", "lavfi",
         "-i", `color=c=${c.color.replace("#", "0x")}:s=${preset.ancho}x${preset.alto}:r=${preset.fps}:d=${c.duracion.toFixed(3)}`,
         "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v],
        dir,
      );
    }
    partes.push(v);
  }
  await writeFile(join(dir, "videos.txt"), partes.map((f) => `file '${f}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "videos.txt", "-c", "copy", "video.mp4"], dir);

  // 2. Pista de textos: rotulos con sus tiempos absolutos
  const rotulos: Rotulo[] = e.textos
    .filter((t) => t.texto.trim())
    .map((t) => ({
      inicio: t.inicio,
      fin: t.inicio + t.duracion,
      texto: t.texto,
      estilo: t.estilo,
      animacion: t.animacion,
      lectura: t.lectura,
    }));
  await writeFile(join(dir, "subs.ass"), crearASSProyecto(rotulos, preset));

  // 3. Mezcla: imagen congelada si hace falta, voz colocada en su instante,
  //    musica con ducking cuando hay voz
  const args = ["-i", "video.mp4"];
  const relleno = total - tVideo;
  let filtro =
    (relleno > 0.01 ? `[0:v]tpad=stop_mode=clone:stop_duration=${relleno.toFixed(3)}[vp];[vp]` : "[0:v]") +
    `subtitles=subs.ass:fontsdir=${escapar(FONTS_DIR)}[v];`;
  let idx = 1;
  let vozIdx: number | null = null;

  if (conVoz) {
    args.push("-i", e.rutaVoz!);
    vozIdx = idx++;
    const ms = Math.round(e.voz.inicio * 1000);
    filtro += `[${vozIdx}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms}[voz];`;
  }

  if (e.rutaMusica) {
    args.push("-stream_loop", "-1", "-i", e.rutaMusica);
    const m = idx++;
    if (vozIdx !== null) {
      filtro +=
        `[${m}:a]volume=${e.musica.volumen}[m];[voz]asplit=2[vz][sc];` +
        "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck];" +
        "[vz][duck]amix=inputs=2:duration=first:normalize=0[mix];";
    } else {
      filtro += `[${m}:a]volume=${Math.max(e.musica.volumen, 0.6)}[mix];`;
    }
  } else if (vozIdx !== null) {
    filtro += "[voz]anull[mix];";
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    filtro += `[${idx++}:a]anull[mix];`;
  }
  filtro += "[mix]loudnorm=I=-14:TP=-1.5:LRA=11[a]";

  args.push(
    "-filter_complex", filtro, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(preset.fps),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart",
    "-t", total.toFixed(3), "final.mp4",
  );
  await ffmpeg(args, dir, 30 * 60_000);

  const archivo = join(dir, "final.mp4");
  const { size } = await stat(archivo);
  if (size > MAX_VIDEO_BYTES) {
    throw new Error(
      `El video compilado pesa ${(size / MB).toFixed(1)} MB y supera el limite de ${env.MAX_VIDEO_MB} MB (MAX_VIDEO_MB).`,
    );
  }
  return { archivo, duracion: total, bytes: size, preset: preset as Preset };
}
