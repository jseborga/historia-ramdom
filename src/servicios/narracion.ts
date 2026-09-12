import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generarVoz, limpiarMarcas } from "./voz.js";
import { huellaVoz, type VozPista } from "./proyecto.js";
import { ffmpeg, duracionAudio, concatenarWav } from "../render/ffmpeg.js";
import { crearCarpetaProyecto, crearCarpetaTrabajo, borrarCarpetaTemporal } from "../almacen.js";
import { fragmentar } from "../render/rotulos.js";

/** Los proveedores de IA no admiten textos largos: se agrupan frases. */
const MAX_TROZO = 900;
/** Silencio entre frases al pegarlas. */
const PAUSA = 0.28;

export type Tramo = { texto: string; inicio: number; duracion: number };

/** Con IA se agrupan frases hasta ~900 caracteres para no hacer cien llamadas. */
function agrupar(frases: string[]): string[] {
  const salida: string[] = [];
  let actual = "";
  for (const f of frases) {
    if ((actual + " " + f).length > MAX_TROZO && actual) {
      salida.push(actual.trim());
      actual = f;
    } else actual = actual ? `${actual} ${f}` : f;
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

/**
 * Genera la narracion con UNA sola voz, frase a frase, y devuelve ademas
 * donde empieza y cuanto dura cada frase en el audio final. Eso es lo que
 * hace que el texto pueda ir apareciendo exactamente cuando se lee.
 */
export async function generarNarracion(proyectoId: string, voz: VozPista) {
  if (voz.modo !== "servidor") throw new Error("La narracion solo se genera en modo servidor");
  if (!voz.texto.trim()) throw new Error("La narracion esta vacia");

  const dir = await crearCarpetaProyecto(proyectoId);
  const config = voz.config ?? { proveedor: "local" as const, modelo: "espeak-ng", nombre: "es-419" };
  const trabajo = await crearCarpetaTrabajo(`voz-${proyectoId}`);
  const frases = fragmentar(voz.texto, "frases");
  const trozos = config.proveedor === "local" ? frases : agrupar(frases);
  const nombreFinal = "voz-servidor.wav";

  try {
    const generados: string[] = [];
    for (const [i, t] of trozos.entries()) {
      const bruto = await generarVoz(config, t, trabajo, i);
      if (config.proveedor === "local") {
        generados.push(join(trabajo, bruto));
      } else {
        // mp3 o wav de IA: todo a 48 kHz estereo para poder pegarlo
        const wav = `n${i}.wav`;
        await ffmpeg(["-i", bruto, "-ar", "48000", "-ac", "2", wav], trabajo);
        generados.push(join(trabajo, wav));
      }
    }

    let tramos: Tramo[];
    let duracion: number;
    try {
      // Sin ffmpeg: pegado en Node, con los inicios exactos de cada frase.
      const r = await concatenarWav(generados, join(dir, nombreFinal), PAUSA);
      // Los rotulos no deben mostrar las marcas de tono: se quitan del texto del tramo.
      tramos = trozos.map((texto, i) => ({ texto: limpiarMarcas(texto), inicio: r.inicios[i], duracion: r.duraciones[i] }));
      duracion = r.total;
    } catch {
      // Formatos distintos entre trozos (raro): lo pega ffmpeg y se miden aparte.
      await writeFile(join(trabajo, "lista.txt"), generados.map((g) => `file '${g}'`).join("\n"));
      await ffmpeg(["-f", "concat", "-safe", "0", "-i", "lista.txt", "-ar", "48000", "-ac", "2", join(dir, nombreFinal)], trabajo);
      const duraciones = await Promise.all(generados.map((g) => duracionAudio(g)));
      let t = 0;
      tramos = trozos.map((texto, i) => {
        const tr = { texto: limpiarMarcas(texto), inicio: t, duracion: duraciones[i] };
        t += duraciones[i];
        return tr;
      });
      duracion = await duracionAudio(join(dir, nombreFinal));
    }

    return { archivo: nombreFinal, duracion, huella: huellaVoz(voz), tramos };
  } finally {
    await borrarCarpetaTemporal(trabajo);
  }
}

/** Solo para comprobar que el archivo sigue ahi antes de renderizar. */
export async function narracionExiste(proyectoId: string, archivo: string) {
  return readFile(join(await crearCarpetaProyecto(proyectoId), archivo))
    .then(() => true)
    .catch(() => false);
}

export { rename as _renombrar };
