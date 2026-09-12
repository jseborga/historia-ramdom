import { randomUUID } from "node:crypto";
import { copyFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { crearCarpetaProyecto, rutaMusicaSegura, rutaSubidaSegura } from "../almacen.js";
import { ffmpeg, duracionAudio, tieneAudio } from "../render/ffmpeg.js";
import { importarSunoAProyecto, enlaceSuno } from "./suno.js";
import type { ParteMusica } from "./proyecto.js";

/**
 * Varias canciones, un solo videoclip.
 *
 * Suno entrega temas de dos o tres minutos; para un videoclip largo se
 * encadenan dos o mas en una sola pista. Cada cancion se baja (o se copia) a
 * la carpeta del proyecto y de ahi sale UN archivo mezclado, con el minuto y
 * segundo exactos en los que empieza cada una: eso es lo que despues permite
 * que cada cancion tenga sus propias imagenes y su propia letra.
 */

/** De donde sale cada cancion de la lista. */
export type FuenteCancion = {
  tipo: "suno" | "biblioteca" | "proyecto";
  /** Enlace de Suno (tipo "suno") o nombre de archivo (biblioteca / proyecto). */
  valor: string;
  /** Letra de ESTA cancion; con ella cada tema tiene sus propios tramos. */
  letra?: string;
  titulo?: string;
};

export const MAX_CANCIONES = 8;
/** Segundos de solape entre canciones; 0 = corte seco. */
export const CRUCE_POR_DEFECTO = 1.5;

/** Deja cada cancion dentro del proyecto y la mide. */
async function traerCancion(proyectoId: string, f: FuenteCancion, indice: number) {
  const dir = await crearCarpetaProyecto(proyectoId);

  if (f.tipo === "suno") {
    const r = await importarSunoAProyecto(proyectoId, f.valor);
    return {
      archivo: r.archivo,
      ruta: join(dir, r.archivo),
      enlace: r.enlace,
      duracion: r.duracion ?? (await duracionAudio(join(dir, r.archivo))),
    };
  }

  if (f.tipo === "proyecto") {
    // Ya subida a este proyecto: solo se comprueba que sigue estando.
    const ruta = rutaSubidaSegura(proyectoId, f.valor);
    return { archivo: f.valor, ruta, enlace: enlaceSuno(f.valor), duracion: await duracionAudio(ruta) };
  }

  // De la biblioteca compartida: se copia al proyecto para que el montaje no
  // dependa de que la pista siga ahi dentro de un mes.
  const origen = rutaMusicaSegura(f.valor);
  const extension = /\.([a-z0-9]+)$/i.exec(f.valor)?.[1]?.toLowerCase() ?? "mp3";
  const archivo = `parte-${indice + 1}-${randomUUID().slice(0, 8)}.${extension}`;
  const ruta = join(dir, archivo);
  await copyFile(origen, ruta);
  return { archivo, ruta, enlace: enlaceSuno(f.valor), duracion: await duracionAudio(ruta) };
}

/**
 * Encadena las canciones en un solo archivo y devuelve donde empieza cada una.
 * Con una sola cancion no se mezcla nada: se usa tal cual.
 */
export async function unirCanciones(
  proyectoId: string,
  fuentes: FuenteCancion[],
  cruce = CRUCE_POR_DEFECTO,
): Promise<{ archivo: string; partes: ParteMusica[]; duracion: number }> {
  if (!fuentes.length) throw new Error("No hay ninguna cancion en la lista");
  if (fuentes.length > MAX_CANCIONES) throw new Error(`Como mucho ${MAX_CANCIONES} canciones por videoclip`);

  const dir = await crearCarpetaProyecto(proyectoId);
  type Traida = { archivo: string; ruta: string; enlace: string | null; duracion: number; letra: string; titulo: string };
  const traidas: Traida[] = [];
  for (const [i, f] of fuentes.entries()) {
    const c = await traerCancion(proyectoId, f, i);
    if (!Number.isFinite(c.duracion) || c.duracion < 1) {
      throw new Error(`La cancion ${i + 1} no se pudo medir; prueba a subirla como archivo`);
    }
    traidas.push({ ...c, letra: f.letra ?? "", titulo: (f.titulo ?? "").trim() || `Cancion ${i + 1}` });
  }

  const armarPartes = (archivos: Traida[], solape: number) => {
    let t = 0;
    return archivos.map((c, i) => {
      // Con cruce, cada cancion entra `solape` segundos antes de que acabe la anterior.
      const inicio = i === 0 ? 0 : t - solape;
      t = inicio + c.duracion;
      return {
        archivo: c.archivo,
        titulo: c.titulo,
        enlace: c.enlace,
        inicio: Math.max(0, inicio),
        duracion: c.duracion,
        letra: c.letra,
      } satisfies ParteMusica;
    });
  };

  if (traidas.length === 1) {
    const sola = traidas[0];
    return { archivo: sola.archivo, partes: armarPartes(traidas, 0), duracion: sola.duracion };
  }

  // El cruce no puede comerse una cancion entera.
  const masCorta = Math.min(...traidas.map((c) => c.duracion));
  const solape = Math.max(0, Math.min(cruce, masCorta / 3));

  const salida = `mezcla-${randomUUID().slice(0, 8)}.m4a`;
  const args: string[] = [];
  for (const c of traidas) args.push("-i", c.archivo);

  // Todo a 48 kHz estereo antes de pegar: las canciones pueden venir con
  // formatos distintos y ffmpeg se niega a encadenar lo que no encaja.
  const normaliza = traidas
    .map((_, i) => `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[n${i}]`)
    .join(";");
  let filtro: string;
  if (solape > 0.05) {
    const pasos = traidas
      .slice(1)
      .map((_, i) => `[${i === 0 ? "n0" : `x${i - 1}`}][n${i + 1}]acrossfade=d=${solape.toFixed(3)}:c1=tri:c2=tri[${i === traidas.length - 2 ? "out" : `x${i}`}]`)
      .join(";");
    filtro = `${normaliza};${pasos}`;
  } else {
    const entradas = traidas.map((_, i) => `[n${i}]`).join("");
    filtro = `${normaliza};${entradas}concat=n=${traidas.length}:v=0:a=1[out]`;
  }

  args.push("-filter_complex", filtro, "-map", "[out]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000", salida);
  await ffmpeg(args, dir, 15 * 60_000);

  const ruta = join(dir, salida);
  if (!(await tieneAudio(ruta))) {
    await unlink(ruta).catch(() => {});
    throw new Error("La mezcla de las canciones no produjo audio");
  }
  const duracion = await duracionAudio(ruta);
  return { archivo: salida, partes: armarPartes(traidas, solape), duracion };
}

/** Créditos de la música: una línea por canción, con su enlace si lo tiene. */
export function creditosDePartes(partes: ParteMusica[]): string {
  if (!partes.length) return "";
  const lineas = partes.map((p) =>
    p.enlace ? `Música: ${p.titulo} — Suno: ${p.enlace}` : `Música: ${p.titulo}`,
  );
  return [...new Set(lineas)].join("\n");
}
