import { stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env, MAX_VIDEO_BYTES, MB } from "../env.js";
import { ffmpeg, duracion } from "./ffmpeg.js";
import { buscarPreset, filtroLienzo, type Preset } from "./presets.js";
import { crearASSProyecto, type Rotulo } from "./rotulos.js";
import { descargarClip } from "../servicios/clips.js";
import { generarVoz } from "../servicios/voz.js";
import type { Escena, MusicaCapa, VozCapa } from "../servicios/proyecto.js";

const FONTS_DIR = resolve(process.cwd(), "fonts");
const escapar = (v: string) => v.replace(/([\\:'])/g, "\\$1");

/** Silencio tras cada frase narrada, para que no se peguen unas con otras. */
const PAUSA_VOZ = 0.3;

export type EntradaRender = {
  escenas: Escena[];
  formato: string;
  voz: VozCapa;
  musica: MusicaCapa;
  /** Ruta absoluta de la pista de musica ya resuelta. */
  rutaMusica?: string;
  /** Ruta absoluta del archivo de voz subido, si lo hay. */
  rutaVoz?: string;
};

/**
 * Renderiza la linea de tiempo del editor a un unico MP4.
 *
 * Cada capa se construye por separado —imagen, voz y musica— y solo se juntan
 * al final, asi que se puede cambiar una sin rehacer las otras.
 */
export async function renderizarProyecto(dir: string, entrada: EntradaRender) {
  const preset = buscarPreset(entrada.formato);
  const vf = filtroLienzo(preset);
  const conVozIA = entrada.voz.modo === "ia";
  const conVozArchivo = entrada.voz.modo === "archivo" && Boolean(entrada.rutaVoz);

  const videos: string[] = [];
  const audios: string[] = [];
  const rotulos: Rotulo[] = [];
  let t = 0;

  for (const [i, escena] of entrada.escenas.entries()) {
    let d = escena.duracion;

    // 1. Voz por escena. La escena nunca se acorta por debajo de su audio:
    //    antes se estira, para no cortar la frase a medias.
    if (conVozIA && escena.texto.trim()) {
      const nombre = await generarVoz(
        entrada.voz.config ?? {},
        escena.texto,
        dir,
        i,
      );
      const a = `pa${i}.wav`;
      await ffmpeg(["-i", nombre, "-ar", "48000", "-ac", "2", a], dir);
      const dAudio = (await duracion(a, dir)) + PAUSA_VOZ;
      d = Math.max(d, dAudio);
    }

    // 2. Imagen de la escena: el clip elegido o un fondo de color liso.
    const v = `v${i}.mp4`;
    if (escena.clip) {
      const clip = `c${i}.mp4`;
      await descargarClip(escena.clip.url, join(dir, clip));
      await ffmpeg(
        ["-stream_loop", "-1", "-i", clip, "-t", d.toFixed(3), "-vf", vf, "-an",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v],
        dir,
      );
    } else {
      const color = escena.color.replace("#", "0x");
      await ffmpeg(
        ["-f", "lavfi",
         "-i", `color=c=${color}:s=${preset.ancho}x${preset.alto}:r=${preset.fps}:d=${d.toFixed(3)}`,
         "-vf", "format=yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v],
        dir,
      );
    }
    videos.push(v);

    // 3. Pista de voz alineada: cada trozo dura lo que su escena, con silencio
    //    de relleno, asi la voz cae siempre sobre su propia imagen.
    if (conVozIA) {
      const a = `a${i}.wav`;
      const origen = escena.texto.trim() ? [`pa${i}.wav`] : [];
      if (origen.length) {
        await ffmpeg(
          ["-i", origen[0], "-af", `apad=whole_dur=${d.toFixed(3)}`, "-ar", "48000", "-ac", "2", a],
          dir,
        );
      } else {
        await ffmpeg(
          ["-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
           "-t", d.toFixed(3), a],
          dir,
        );
      }
      audios.push(a);
    }

    rotulos.push({
      inicio: t,
      fin: t + d - 0.1,
      texto: escena.texto,
      estilo: escena.estilo,
      animacion: escena.animacion,
    });
    t += d;
  }

  // 4. Unir las pistas de imagen y de voz
  await writeFile(join(dir, "videos.txt"), videos.map((f) => `file '${f}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "videos.txt", "-c", "copy", "video.mp4"], dir);

  if (conVozIA) {
    await writeFile(join(dir, "audios.txt"), audios.map((f) => `file '${f}'`).join("\n"));
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", "audios.txt", "-c", "copy", "voz.wav"], dir);
  }

  await writeFile(join(dir, "subs.ass"), crearASSProyecto(rotulos, preset));

  // 5. Mezcla final
  const args = ["-i", "video.mp4"];
  let filtro = `[0:v]subtitles=subs.ass:fontsdir=${escapar(FONTS_DIR)}[v];`;
  let indice = 1;
  let vozEntrada: number | null = null;

  if (conVozIA) {
    args.push("-i", "voz.wav");
    vozEntrada = indice++;
  } else if (conVozArchivo) {
    args.push("-i", entrada.rutaVoz!);
    vozEntrada = indice++;
  }

  const musica = entrada.rutaMusica;
  if (musica) {
    args.push("-stream_loop", "-1", "-i", musica);
    const m = indice++;
    if (vozEntrada !== null) {
      // Con voz, la musica se agacha cuando alguien habla.
      filtro +=
        `[${m}:a]volume=${entrada.musica.volumen}[m];[${vozEntrada}:a]asplit=2[vz][sc];` +
        "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck];" +
        "[vz][duck]amix=inputs=2:duration=first:normalize=0[mix];";
    } else {
      filtro += `[${m}:a]volume=${Math.max(entrada.musica.volumen, 0.6)}[mix];`;
    }
  } else if (vozEntrada !== null) {
    filtro += `[${vozEntrada}:a]anull[mix];`;
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    filtro += `[${indice++}:a]anull[mix];`;
  }

  filtro += "[mix]loudnorm=I=-14:TP=-1.5:LRA=11[a]";

  args.push(
    "-filter_complex", filtro,
    "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-r", String(preset.fps),
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000",
    "-movflags", "+faststart",
    "-t", t.toFixed(3),
    "final.mp4",
  );
  await ffmpeg(args, dir, 30 * 60_000);

  const archivo = join(dir, "final.mp4");
  const { size } = await stat(archivo);
  if (size > MAX_VIDEO_BYTES) {
    throw new Error(
      `El video compilado pesa ${(size / MB).toFixed(1)} MB y supera el limite de ` +
        `${env.MAX_VIDEO_MB} MB (MAX_VIDEO_MB).`,
    );
  }

  return { archivo, duracion: t, bytes: size, preset: preset as Preset };
}
