import { copyFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env, MAX_VIDEO_BYTES, MB } from "../env.js";
import { ffmpeg } from "./ffmpeg.js";
import { buscarPreset, filtroEscena, entradaImagen, MAX_DURACION_SEG, type Preset } from "./presets.js";
import { aplicarCalidad, perfilDe, estimar, techoBitrate, bppMedido } from "./calidad.js";
import { crearASSProyecto, type Rotulo } from "./rotulos.js";
import { descargarClip, extensionMedio } from "../servicios/clips.js";
import { rutaMedioSeguro } from "../almacen.js";
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
  /** Título y créditos que viajan dentro del MP4 como metadatos. */
  titulo?: string;
  creditos?: string;
  /** Segundo del archivo de voz por el que empieza (cortes del montaje). */
  vozDesde?: number;
  /** Segundo de la pista de música por el que empieza (cortes del montaje). */
  musicaDesde?: number;
  /**
   * Tope de duración en segundos. Las historias usan el de la app; un
   * videoclip musical trae el suyo, más largo, porque encadena canciones.
   */
  maxSegundos?: number;
  /** Perfil de compresión: "alta", "normal" (por defecto) o "ligera". */
  calidad?: string | null;
  /**
   * Tamaño máximo del archivo en bytes. Si la estimación se pasa, se pone un
   * techo de bitrate para que quepa en vez de renderizar y fallar al final.
   */
  limiteBytes?: number;
  /** Bits por píxel medidos en renders anteriores, para afinar la estimación. */
  bppReal?: number | null;
};

/**
 * Renderiza las tres pistas a un unico MP4. Cada una se construye por su
 * lado —imagen, rotulos, voz— y solo se juntan al final. Si la voz o los
 * textos duran mas que los clips, el ultimo fotograma se congela: nada se corta.
 */
export async function renderizarProyecto(dir: string, e: EntradaRender) {
  // `preset` es el formato tal cual (y la referencia de los rotulos);
  // `lienzo` es lo que se codifica de verdad, que la calidad ligera encoge.
  const preset = buscarPreset(e.formato);
  const perfil = perfilDe(e.calidad);
  const lienzo = aplicarCalidad(preset, e.calidad);
  const conVoz = e.voz.modo !== "ninguna" && Boolean(e.rutaVoz);
  const total = Math.max(
    duracionProyecto({ video: e.video, textos: e.textos, voz: conVoz ? e.voz : { ...e.voz, modo: "ninguna" } }),
    0.5,
  );
  const tVideo = duracionVideo(e.video);
  // El tope es el del formato (los largos admiten 15 min) y, por encima, el
  // que traiga la entrada: un videoclip musical encadena canciones y va aparte.
  const tope = Math.max(e.maxSegundos ?? 0, preset.maxSegundos, MAX_DURACION_SEG, 1);
  if (total > tope + 0.5) {
    throw new Error(
      `El montaje dura ${total.toFixed(0)} s y el tope es ${tope} s. ` +
        "Acórtalo, súbelo por partes o cambia el límite en la configuración.",
    );
  }

  // 1. Pista de video: cada clip con su recorte, duracion y efecto.
  //    Un mismo clip puede salir varias veces en la linea de tiempo (pasa
  //    siempre en los videoclips largos): se descarga UNA vez y se reusa, que
  //    ahorra ancho de banda y, sobre todo, disco en la carpeta de trabajo.
  const partes: string[] = [];
  const descargados = new Map<string, string>();
  for (const [i, c] of e.video.entries()) {
    const v = `v${i}.mp4`;
    const esFoto = c.clip?.tipo === "imagen";
    const vf = filtroEscena(lienzo, c.efecto, c.duracion, esFoto);
    if (c.clip) {
      let origen = descargados.get(c.clip.archivo ?? c.clip.url);
      if (!origen) {
        origen = `fuente${descargados.size}${extensionMedio(c.clip)}`;
        if (c.clip.archivo) {
          // Material de la biblioteca: ya está en disco, se copia y no se
          // descarga nada (ni hay enlace externo que valga).
          await copyFile(rutaMedioSeguro(c.clip.archivo), join(dir, origen));
        } else {
          await descargarClip(c.clip.url, join(dir, origen));
        }
        descargados.set(c.clip.archivo ?? c.clip.url, origen);
      }
      await ffmpeg(
        esFoto
          ? // Una foto no tiene tiempo: se repite el fotograma a la cadencia
            // del lienzo y el movimiento del filtro hace el resto.
            [...entradaImagen(lienzo, origen, c.duracion),
             "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v]
          : ["-stream_loop", "-1", "-i", origen, "-ss", c.recorte.toFixed(3), "-t", c.duracion.toFixed(3),
             "-vf", vf, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v],
        dir,
      );
    } else {
      await ffmpeg(
        ["-f", "lavfi",
         "-i", `color=c=${c.color.replace("#", "0x")}:s=${lienzo.ancho}x${lienzo.alto}:r=${lienzo.fps}:d=${c.duracion.toFixed(3)}`,
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
    // -ss antes de -i abre el archivo mas adelante: es lo que hace que un
    // corte del montaje siga oyendo la parte que le toca, no el principio.
    if (e.vozDesde && e.vozDesde > 0.01) args.push("-ss", e.vozDesde.toFixed(3));
    args.push("-i", e.rutaVoz!);
    vozIdx = idx++;
    const ms = Math.round(e.voz.inicio * 1000);
    filtro += `[${vozIdx}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms}[voz];`;
  }

  if (e.rutaMusica) {
    args.push("-stream_loop", "-1");
    if (e.musicaDesde && e.musicaDesde > 0.01) args.push("-ss", e.musicaDesde.toFixed(3));
    args.push("-i", e.rutaMusica);
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

  // Si por la cuenta no cabe en el limite, se pone techo de bitrate (VBV) en
  // vez de codificar diez minutos para acabar fallando por tamaño.
  const estimado = estimar(total, preset, perfil.id, e.bppReal).bytes;
  const techo = e.limiteBytes ? techoBitrate(total, e.limiteBytes, perfil.id, estimado) : null;

  args.push(
    "-filter_complex", filtro, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", perfil.preset, "-crf", String(perfil.crf),
    ...(techo ? ["-maxrate", String(techo), "-bufsize", String(techo * 2)] : []),
    "-pix_fmt", "yuv420p", "-r", String(lienzo.fps),
    "-c:a", "aac", "-b:a", `${perfil.audioKbps}k`, "-ar", "48000", "-movflags", "+faststart",
    // Los créditos van dentro del archivo: quien lo abra los tiene aunque
    // se pierda el .txt. Los valores van como argumento, nunca por shell.
    ...(e.titulo ? ["-metadata", `title=${e.titulo.slice(0, 200)}`] : []),
    ...(e.creditos ? ["-metadata", `comment=${e.creditos.slice(0, 2000)}`] : []),
    "-t", total.toFixed(3), "final.mp4",
  );
  await ffmpeg(args, dir, 30 * 60_000);

  const archivo = join(dir, "final.mp4");
  const { size } = await stat(archivo);
  if (size > (e.limiteBytes ?? MAX_VIDEO_BYTES)) {
    throw new Error(
      `El video compilado pesa ${(size / MB).toFixed(1)} MB y supera el limite de ${env.MAX_VIDEO_MB} MB (MAX_VIDEO_MB).`,
    );
  }
  return {
    archivo,
    duracion: total,
    bytes: size,
    preset: preset as Preset,
    lienzo: lienzo as Preset,
    calidad: perfil.id,
    // Lo que ha pesado de verdad, para que la proxima estimacion sea mejor.
    bpp: bppMedido(size, total, lienzo),
  };
}
