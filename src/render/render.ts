import { stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env, MAX_VIDEO_BYTES, MB } from "../env.js";
import { ffmpeg, duracion } from "./ffmpeg.js";
import { crearASS, type Tramo } from "./subtitulos.js";
import { PRESET_POR_DEFECTO, filtroEscena, entradaImagen, movimientoPorIndice } from "./presets.js";

const VF =
  "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p";

/** Silencio al final de cada escena narrada, para que no se pisen las frases. */
const PAUSA = 0.4;
/** Margen entre subtitulos cuando no hay voz que marque el ritmo. */
const PAUSA_TEXTO = 0.15;

/** Palabras por segundo de lectura comoda en pantalla. */
const PALABRAS_POR_SEGUNDO = 2.2;
const MIN_ESCENA = 2.5;
const MAX_ESCENA = 10;

/** Carpeta de fuentes que libass usa al quemar los subtitulos. */
const FONTS_DIR = resolve(process.cwd(), "fonts");
/** En un filtro de ffmpeg hay que escapar \ : ' y , */
const escapar = (v: string) => v.replace(/([\\:'])/g, "\\$1");

export type ModoAudio = "VOZ" | "MUSICA" | "MUDO";

/**
 * Cuanto dura una escena sin voz. Si la serie fija un valor se respeta; si no,
 * se calcula por lo que cuesta leer el texto en pantalla.
 */
export function duracionPorTexto(texto: string, fijo?: number | null) {
  if (fijo && fijo > 0) return fijo;
  const palabras = texto.trim().split(/\s+/).filter(Boolean).length;
  const segundos = palabras / PALABRAS_POR_SEGUNDO + 1;
  return Math.min(Math.max(segundos, MIN_ESCENA), MAX_ESCENA);
}

export type EscenaRender = {
  texto: string;
  /** nombre del clip dentro de `dir` */
  archivo: string;
  /** El archivo es una foto: se anima con Ken Burns en vez de quedarse quieta. */
  imagen?: boolean;
  /** nombre del audio dentro de `dir`; solo en modo VOZ */
  audio?: string;
  /** duracion impuesta cuando no hay audio que la marque */
  duracion?: number;
  /** La escena de enganche se rotula con su propio estilo. */
  esGancho?: boolean;
};

export type OpcionesRender = {
  modoAudio?: ModoAudio;
  /** Ruta absoluta de la pista de fondo. */
  musica?: string;
};

/**
 * El vídeo y el audio se arman por separado: la pista de imagen se construye
 * con la duracion de cada escena —que puede venir del audio o del texto— y
 * solo al final se mezcla con lo que corresponda, o con nada.
 */
export async function renderizar(
  dir: string,
  escenas: EscenaRender[],
  opciones: OpcionesRender = {},
) {
  if (!escenas.length) throw new Error("No hay escenas que renderizar");
  const modoAudio = opciones.modoAudio ?? "VOZ";
  const conVoz = modoAudio === "VOZ";
  const musica = modoAudio === "MUDO" ? undefined : opciones.musica;

  const videos: string[] = [];
  const audios: string[] = [];
  const tramos: Tramo[] = [];
  let t = 0;

  for (const [i, e] of escenas.entries()) {
    let d: number;

    if (conVoz) {
      if (!e.audio) throw new Error(`La escena ${i + 1} no tiene audio`);
      // 1a. Audio normalizado con la pausa al final
      const a = `a${i}.wav`;
      await ffmpeg(
        ["-i", e.audio, "-af", `apad=pad_dur=${PAUSA}`, "-ar", "48000", "-ac", "2", a],
        dir,
      );
      d = await duracion(a, dir);
      audios.push(a);
    } else {
      // 1b. Sin voz, manda el texto: la escena dura lo que cuesta leerla
      d = e.duracion ?? duracionPorTexto(e.texto);
    }

    // 2. Clip vertical con la duracion exacta de la escena. Si la fuente es
    //    una foto (la NASA da muchas), se le pone movimiento: un plano fijo
    //    de ocho segundos en un vertical parece que se colgo el video.
    const v = `v${i}.mp4`;
    await ffmpeg(
      e.imagen
        ? [
            ...entradaImagen(PRESET_POR_DEFECTO, e.archivo, d),
            "-vf", filtroEscena(PRESET_POR_DEFECTO, movimientoPorIndice(i), d, true),
            "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v,
          ]
        : [
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
    tramos.push({
      inicio: t,
      fin: t + d - (conVoz ? PAUSA : PAUSA_TEXTO),
      texto: e.texto,
      estilo: e.esGancho ? "Gancho" : "Voz",
    });
    t += d;
  }

  // 3. Unir partes (todas tienen el mismo formato, asi que no se recodifican)
  await writeFile(join(dir, "videos.txt"), videos.map((f) => `file '${f}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", "videos.txt", "-c", "copy", "video.mp4"], dir);
  if (conVoz) {
    await writeFile(join(dir, "audios.txt"), audios.map((f) => `file '${f}'`).join("\n"));
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", "audios.txt", "-c", "copy", "voz.wav"], dir);
  }
  await writeFile(join(dir, "subs.ass"), crearASS(tramos));

  // 4. Mezcla final: subtitulos siempre; el audio, segun el modo
  const args = ["-i", "video.mp4"];
  let filtro = `[0:v]subtitles=subs.ass:fontsdir=${escapar(FONTS_DIR)}[v];`;

  if (conVoz) {
    args.push("-i", "voz.wav");
    if (musica) {
      args.push("-stream_loop", "-1", "-i", musica);
      filtro +=
        "[2:a]volume=0.25[m];[1:a]asplit=2[vz][sc];" +
        "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck];" +
        "[vz][duck]amix=inputs=2:duration=first:normalize=0[mix];";
    } else {
      filtro += "[1:a]anull[mix];";
    }
  } else if (musica) {
    // Sin voz la musica lleva todo el peso, asi que no se agacha.
    args.push("-stream_loop", "-1", "-i", musica);
    filtro += "[1:a]volume=0.8[mix];";
  } else {
    // Pista muda: mas compatible que un MP4 sin audio ninguno.
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
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
