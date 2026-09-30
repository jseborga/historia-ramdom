import { copyFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { env, MAX_VIDEO_BYTES, MB } from "../env.js";
import { ffmpeg } from "./ffmpeg.js";
import {
  buscarPreset,
  filtroEscena,
  grafoAjustar,
  entradaImagen,
  XFADE,
  MAX_DURACION_SEG,
  type Preset,
} from "./presets.js";
import { aplicarCalidad, perfilDe, estimar, techoBitrate, bppMedido } from "./calidad.js";
import { crearASSProyecto, type Rotulo } from "./rotulos.js";
import { descargarDeClip, extensionMedio } from "../servicios/clips.js";
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
 * Une los trozos con transiciones sin cambiar la duración total.
 *
 * `xfade` solapa los dos clips, así que cada trozo se renderizó con medio
 * cruce de más por cada lado: lo que el solape quita, el material extra lo
 * devuelve. El resultado dura exactamente lo que dice la línea de tiempo, que
 * es lo que mantiene la voz y los rótulos en su sitio.
 *
 * Los tramos sin transición se pegan con `concat` dentro del mismo grafo, así
 * que se pueden mezclar cortes secos y cruces.
 */
async function unirConTransiciones(
  dir: string,
  partes: string[],
  video: ClipPista[],
  cruce: number[],
  lienzo: Preset,
) {
  const entradas = partes.flatMap((f) => ["-i", f]);
  // Todas las entradas a la misma base de tiempos: `concat` deja una y los
  // trozos crudos traen otra, y `xfade` se niega a mezclar bases distintas.
  // Ojo al orden: `fps` deja su propia base (1/fps), así que `settb` va después.
  const pasos: string[] = partes.map((_, i) => `[${i}:v]fps=${lienzo.fps},settb=AVTB[e${i}]`);
  let etiqueta = "e0";
  // Duración acumulada de lo que llevamos unido; con ella se calcula dónde
  // empieza cada cruce.
  let acumulado = video[0].duracion + cruce[0] / 2;

  for (let i = 1; i < partes.length; i++) {
    const d = cruce[i - 1];
    const salida = i === partes.length - 1 ? "v" : `u${i}`;
    const largo = video[i].duracion + cruce[i - 1] / 2 + (cruce[i] ?? 0) / 2;
    if (d > 0) {
      const tipo = XFADE[video[i - 1].transicion] || "fade";
      pasos.push(
        `[${etiqueta}][e${i}]xfade=transition=${tipo}:duration=${d.toFixed(3)}:offset=${(acumulado - d).toFixed(3)}[${salida}]`,
      );
      acumulado += largo - d;
    } else {
      pasos.push(`[${etiqueta}][e${i}]concat=n=2:v=1:a=0,settb=AVTB[${salida}]`);
      acumulado += largo;
    }
    etiqueta = salida;
  }

  await ffmpeg(
    [
      ...entradas,
      "-filter_complex",
      `${pasos.join(";")};[${etiqueta}]format=yuv420p,fps=${lienzo.fps}[salida]`,
      "-map", "[salida]",
      "-an",
      "-c:v", "libx264",
      "-preset", "veryfast",
      "-crf", "20",
      "video.mp4",
    ],
    dir,
  );
}

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
  // Transiciones: cada una se come medio segundo (el que sea) de cada lado, así
  // que los clips vecinos se renderizan un poco más largos y el cruce devuelve
  // la duración exacta de la línea de tiempo. `cruce[i]` es la que va DESPUÉS
  // del clip i.
  const cruce = e.video.map((c, i) =>
    i < e.video.length - 1 && c.transicion !== "ninguna"
      ? // Nunca más de la mitad del clip más corto: si no, el cruce se come el plano.
        Math.max(0.2, Math.min(c.transicionSeg, e.video[i].duracion / 2, e.video[i + 1].duracion / 2))
      : 0,
  );
  const conTransiciones = cruce.some((d) => d > 0);
  /** El sonido de los clips que lo conservan, cada uno con su instante. */
  const sonidos: { archivo: string; inicio: number }[] = [];
  let enLinea = 0;

  for (const [i, c] of e.video.entries()) {
    const inicioEnLinea = enLinea;
    enLinea += c.duracion;
    const v = `v${i}.mp4`;
    const esFoto = c.clip?.tipo === "imagen";
    // Material extra para el cruce de entrada y el de salida.
    const extraEntrada = (cruce[i - 1] ?? 0) / 2;
    const extraSalida = cruce[i] / 2;
    const largo = c.duracion + extraEntrada + extraSalida;
    const desde = Math.max(0, c.recorte - extraEntrada);
    const ajustar = c.encuadre === "ajustar";
    const vf = filtroEscena(lienzo, c.efecto, largo, esFoto);
    // "Ajustar" necesita un grafo (partir, desenfocar, superponer), no una
    // cadena simple: va por -filter_complex con su salida etiquetada.
    const filtro = ajustar
      ? ["-filter_complex", grafoAjustar(lienzo, c.efecto, largo, esFoto), "-map", "[v]"]
      : ["-vf", vf];
    if (c.clip) {
      let origen = descargados.get(c.clip.archivo ?? c.clip.url);
      if (!origen) {
        origen = `fuente${descargados.size}${extensionMedio(c.clip)}`;
        if (c.clip.archivo) {
          // Material de la biblioteca: ya está en disco, se copia y no se
          // descarga nada (ni hay enlace externo que valga).
          await copyFile(rutaMedioSeguro(c.clip.archivo), join(dir, origen));
        } else {
          await descargarDeClip(c.clip, join(dir, origen));
        }
        descargados.set(c.clip.archivo ?? c.clip.url, origen);
      }
      await ffmpeg(
        esFoto
          ? // Una foto no tiene tiempo: se repite el fotograma a la cadencia
            // del lienzo y el movimiento del filtro hace el resto.
            [...entradaImagen(lienzo, origen, largo),
             ...filtro, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v]
          : ["-stream_loop", "-1", "-i", origen, "-ss", desde.toFixed(3), "-t", largo.toFixed(3),
             ...filtro, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v],
        dir,
      );
      // El sonido va aparte del vídeo, como la voz: la imagen se pega o se
      // funde entre planos y el sonido se coloca en su segundo exacto. Se
      // corta a lo que dura el plano en la línea de tiempo, con un fundido
      // cortito en cada punta para que el corte no haga clic.
      if (c.audio && !esFoto) {
        const a = `a${i}.wav`;
        const fin = Math.max(c.duracion - 0.12, 0);
        const ok = await ffmpeg(
          ["-ss", c.recorte.toFixed(3), "-i", origen, "-t", c.duracion.toFixed(3), "-vn", "-ac", "2", "-ar", "48000",
           "-af", `afade=t=in:d=0.06,afade=t=out:st=${fin.toFixed(3)}:d=0.12`, a],
          dir,
        ).then(
          () => true,
          // Un clip sin pista de sonido no es un error: se queda mudo.
          () => false,
        );
        if (ok) sonidos.push({ archivo: a, inicio: inicioEnLinea });
      }
    } else {
      await ffmpeg(
        ["-f", "lavfi",
         "-i", `color=c=${c.color.replace("#", "0x")}:s=${lienzo.ancho}x${lienzo.alto}:r=${lienzo.fps}:d=${largo.toFixed(3)}`,
         "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v],
        dir,
      );
    }
    partes.push(v);
  }

  if (!conTransiciones) {
    // Sin transiciones no hay nada que recodificar: se pegan tal cual.
    await writeFile(join(dir, "videos.txt"), partes.map((f) => `file '${f}'`).join("\n"));
    await ffmpeg(["-f", "concat", "-safe", "0", "-i", "videos.txt", "-c", "copy", "video.mp4"], dir);
  } else {
    await unirConTransiciones(dir, partes, e.video, cruce, lienzo);
  }

  // El sonido de los clips, todo en una pista: cada uno en su instante.
  let rutaSonidos: string | null = null;
  if (sonidos.length) {
    const entradas = sonidos.flatMap((x) => ["-i", x.archivo]);
    const colocados = sonidos
      .map((x, k) => {
        const ms = Math.round(x.inicio * 1000);
        return `[${k}:a]adelay=${ms}|${ms}[s${k}]`;
      })
      .join(";");
    const juntos =
      sonidos.length === 1
        ? `${colocados};[s0]anull[out]`
        : `${colocados};${sonidos.map((_, k) => `[s${k}]`).join("")}amix=inputs=${sonidos.length}:duration=longest:normalize=0[out]`;
    await ffmpeg([...entradas, "-filter_complex", juntos, "-map", "[out]", "-ac", "2", "-ar", "48000", "sonidos.wav"], dir);
    rutaSonidos = "sonidos.wav";
  }

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
      ...(t.resalte ? { resalte: t.resalte } : {}),
    }));
  await writeFile(join(dir, "subs.ass"), crearASSProyecto(rotulos, preset));

  // 3. Mezcla: imagen congelada si hace falta, voz colocada en su instante,
  //    musica con ducking cuando hay voz
  //    El sonido se mezcla en un paso aparte, a un WAV de la duración exacta:
  //    en el mismo grafo que la imagen, ffmpeg perdía segundos de audio por el
  //    camino (con música en bucle y loudnorm, un tráiler de 29 s se quedaba
  //    en 25 s de sonido y los diálogos se adelantaban a su plano).
  const args: string[] = [];
  let filtro = "";
  let idx = 0;
  /**
   * Lo que se habla: la narración, el sonido de los clips (el diálogo de un
   * plano de Veo) o las dos cosas. Es lo que manda sobre la música: cuando
   * suena, la música se aparta.
   */
  const habla: string[] = [];

  if (conVoz) {
    // -ss antes de -i abre el archivo mas adelante: es lo que hace que un
    // corte del montaje siga oyendo la parte que le toca, no el principio.
    if (e.vozDesde && e.vozDesde > 0.01) args.push("-ss", e.vozDesde.toFixed(3));
    args.push("-i", e.rutaVoz!);
    const vozIdx = idx++;
    const ms = Math.round(e.voz.inicio * 1000);
    filtro += `[${vozIdx}:a]aformat=channel_layouts=stereo,adelay=${ms}|${ms}[voz];`;
    habla.push("[voz]");
  }
  if (rutaSonidos) {
    args.push("-i", rutaSonidos);
    filtro += `[${idx++}:a]aformat=channel_layouts=stereo[clips];`;
    habla.push("[clips]");
  }
  let hablado: string | null = null;
  if (habla.length === 1) hablado = habla[0];
  else if (habla.length === 2) {
    filtro += `${habla.join("")}amix=inputs=2:duration=longest:normalize=0[hablado];`;
    hablado = "[hablado]";
  }

  if (e.rutaMusica) {
    args.push("-stream_loop", "-1");
    if (e.musicaDesde && e.musicaDesde > 0.01) args.push("-ss", e.musicaDesde.toFixed(3));
    args.push("-i", e.rutaMusica);
    const m = idx++;
    if (hablado) {
      // apad antes de repartir: sidechaincompress deja de sacar música en
      // cuanto se le acaba la entrada que la aparta, así que sin esto la
      // música se cortaba en seco con la última frase (los cartones del final
      // de un tráiler salían mudos). Rellenando lo hablado con silencio, la
      // música vuelve a su volumen al callar y el -t final corta el total.
      filtro +=
        `[${m}:a]volume=${e.musica.volumen}[m];${hablado}apad,asplit=2[vz][sc];` +
        "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck];" +
        "[vz][duck]amix=inputs=2:duration=first:normalize=0[mix];";
    } else {
      filtro += `[${m}:a]volume=${Math.max(e.musica.volumen, 0.6)}[mix];`;
    }
  } else if (hablado) {
    filtro += `${hablado}anull[mix];`;
  } else {
    args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
    filtro += `[${idx++}:a]anull[mix];`;
  }
  // apad: si lo hablado acaba antes que la imagen, el resto va en silencio en
  // vez de dejar una pista de sonido más corta que el vídeo.
  filtro += `[mix]apad,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,atrim=0:${total.toFixed(3)}[a]`;
  await ffmpeg([...args, "-filter_complex", filtro, "-map", "[a]", "-ac", "2", "-c:a", "pcm_s16le", "mezcla.wav"], dir, 30 * 60_000);

  const relleno = total - tVideo;
  const filtroVideo =
    (relleno > 0.01 ? `[0:v]tpad=stop_mode=clone:stop_duration=${relleno.toFixed(3)}[vp];[vp]` : "[0:v]") +
    `subtitles=subs.ass:fontsdir=${escapar(FONTS_DIR)}[v]`;

  // Si por la cuenta no cabe en el limite, se pone techo de bitrate (VBV) en
  // vez de codificar diez minutos para acabar fallando por tamaño.
  const estimado = estimar(total, preset, perfil.id, e.bppReal).bytes;
  const techo = e.limiteBytes ? techoBitrate(total, e.limiteBytes, perfil.id, estimado) : null;

  const final = [
    "-i", "video.mp4", "-i", "mezcla.wav",
    "-filter_complex", filtroVideo, "-map", "[v]", "-map", "1:a",
    "-c:v", "libx264", "-preset", perfil.preset, "-crf", String(perfil.crf),
    ...(techo ? ["-maxrate", String(techo), "-bufsize", String(techo * 2)] : []),
    "-pix_fmt", "yuv420p", "-r", String(lienzo.fps),
    "-c:a", "aac", "-b:a", `${perfil.audioKbps}k`, "-ar", "48000", "-movflags", "+faststart",
    // Los créditos van dentro del archivo: quien lo abra los tiene aunque
    // se pierda el .txt. Los valores van como argumento, nunca por shell.
    ...(e.titulo ? ["-metadata", `title=${e.titulo.slice(0, 200)}`] : []),
    ...(e.creditos ? ["-metadata", `comment=${e.creditos.slice(0, 2000)}`] : []),
    "-t", total.toFixed(3), "final.mp4",
  ];
  await ffmpeg(final, dir, 30 * 60_000);

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
