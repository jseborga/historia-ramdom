import { spawn } from "node:child_process";

/**
 * Analisis de la pista de musica para saber DONDE esta lo bueno.
 *
 * No hace falta entender de musica: el estribillo casi siempre es la parte
 * con mas energia (mas instrumentos sonando a la vez), asi que se mide el
 * nivel RMS segundo a segundo y se busca la ventana que mas suma. Si ademas
 * se sabe donde cae el coro por la letra, ese tramo puntua mas alto.
 */

/** Silencio total: ffmpeg imprime "-inf"; se trata como muy bajo, no como cero. */
const SILENCIO_DB = -91;

/**
 * Nivel RMS (dB) de cada segundo del audio. Una sola pasada de ffmpeg que no
 * escribe ningun archivo: remuestrea a 8 kHz, parte en trozos de un segundo y
 * pide a astats el nivel de cada uno.
 */
export function energiaPorSegundo(archivo: string, timeoutMs = 5 * 60_000) {
  return new Promise<number[]>((resolve, reject) => {
    const p = spawn("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-i", archivo, "-map", "0:a:0",
      "-af",
      "aresample=8000,asetnsamples=n=8000,astats=metadata=1:reset=1," +
        "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
      "-f", "null", "-",
    ]);
    let salida = "";
    let errores = "";
    // Una cancion de 5 minutos son 300 lineas: no hay riesgo de crecer sin freno.
    p.stdout.on("data", (d) => (salida = (salida + d).slice(-200_000)));
    p.stderr.on("data", (d) => (errores = (errores + d).slice(-2000)));
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("error", (err) => {
      clearTimeout(t);
      reject(new Error(`No se pudo ejecutar ffmpeg: ${err.message}`));
    });
    p.on("close", (code) => {
      clearTimeout(t);
      if (code !== 0) return reject(new Error(`ffmpeg no pudo analizar el audio: ${errores}`));
      const niveles = [...salida.matchAll(/RMS_level=(-?[\d.]+|-?inf)/g)].map((m) => {
        const v = Number(m[1]);
        return Number.isFinite(v) ? v : SILENCIO_DB;
      });
      resolve(niveles);
    });
  });
}

export type Momento = {
  /** Segundo del audio en el que empieza el corte. */
  inicio: number;
  duracion: number;
  /** 0 a 1: cuanta energia tiene comparado con el resto de la cancion. */
  puntuacion: number;
  /** De donde sale: la letra o el nivel del audio. */
  motivo: string;
};

/** Tramo con nombre dentro de la cancion, para dar contexto a los momentos. */
export type TramoLetra = { etiqueta: string; inicio: number; duracion: number; destacada: boolean };

const aLineal = (db: number) => 10 ** (db / 10);

/**
 * Los mejores tramos de `ventana` segundos, sin solaparse entre ellos.
 *
 * Se suma la energia de cada ventana posible y se prefiere la que mas suma;
 * un tramo marcado como destacado en la letra (el coro) recibe un empujon
 * proporcional a cuanto se solapa con el. El primer par de segundos se
 * descarta: casi ninguna cancion arranca en lo mejor.
 */
export function mejoresMomentos(
  energias: number[],
  ventana = 30,
  tramos: TramoLetra[] = [],
  cuantos = 3,
): Momento[] {
  const total = energias.length;
  if (!total) return [];
  const ancho = Math.min(Math.max(Math.round(ventana), 1), total);
  const lineal = energias.map(aLineal);
  const ultimo = total - ancho;
  if (ultimo < 0) return [{ inicio: 0, duracion: total, puntuacion: 1, motivo: "la cancion entera" }];

  /** Cuantos segundos de la ventana caen dentro de un tramo destacado. */
  const solape = (inicio: number) =>
    tramos
      .filter((t) => t.destacada)
      .reduce(
        (s, t) => s + Math.max(0, Math.min(inicio + ancho, t.inicio + t.duracion) - Math.max(inicio, t.inicio)),
        0,
      );

  const candidatos = [];
  let suma = lineal.slice(0, ancho).reduce((a, b) => a + b, 0);
  for (let i = 0; i <= ultimo; i++) {
    if (i > 0) suma += lineal[i + ancho - 1] - lineal[i - 1];
    // Arrancar en el primer segundo suele pillar la entrada, no el tema.
    const castigo = i < 2 ? 0.85 : 1;
    const empuje = 1 + solape(i) / ancho;
    candidatos.push({ inicio: i, energia: suma / ancho, puntuacion: (suma / ancho) * empuje * castigo, coro: solape(i) > ancho / 3 });
  }

  const maximo = Math.max(...candidatos.map((c) => c.puntuacion)) || 1;
  const elegidos: Momento[] = [];
  for (const c of [...candidatos].sort((a, b) => b.puntuacion - a.puntuacion)) {
    // Dos cortes que se pisan son el mismo corte: se exige medio hueco.
    if (elegidos.some((e) => Math.abs(e.inicio - c.inicio) < ancho / 2)) continue;
    const dentro = tramos.find((t) => c.inicio >= t.inicio - 1 && c.inicio < t.inicio + t.duracion);
    elegidos.push({
      inicio: c.inicio,
      duracion: ancho,
      puntuacion: Math.round((c.puntuacion / maximo) * 100) / 100,
      motivo: c.coro && dentro ? `${dentro.etiqueta} (lo mas fuerte)` : dentro ? dentro.etiqueta : "el tramo con mas energia",
    });
    if (elegidos.length >= cuantos) break;
  }
  return elegidos;
}
