import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { generarVoz } from "./voz.js";
import { huellaVoz, type VozPista } from "./proyecto.js";
import { ffmpeg, duracionAudio } from "../render/ffmpeg.js";
import { crearCarpetaProyecto, crearCarpetaTrabajo, borrarCarpetaTemporal } from "../almacen.js";
import { fragmentar } from "../render/rotulos.js";

/** Los proveedores de IA no admiten textos largos: se trocea por frases. */
const MAX_TROZO = 900;

function trocear(texto: string): string[] {
  const salida: string[] = [];
  let actual = "";
  for (const frase of fragmentar(texto, "frases")) {
    if ((actual + " " + frase).length > MAX_TROZO && actual) {
      salida.push(actual.trim());
      actual = frase;
    } else {
      actual = actual ? `${actual} ${frase}` : frase;
    }
  }
  if (actual.trim()) salida.push(actual.trim());
  return salida;
}

/**
 * Genera la narracion completa del proyecto con UNA sola voz y la deja en su
 * carpeta. Devuelve el nombre del archivo y su duracion real, que es lo que
 * la linea de tiempo necesita para sincronizar el resto.
 */
export async function generarNarracion(proyectoId: string, voz: VozPista) {
  if (voz.modo !== "servidor") throw new Error("La narracion solo se genera en modo servidor");
  if (!voz.texto.trim()) throw new Error("La narracion esta vacia");

  const dir = await crearCarpetaProyecto(proyectoId);
  const config = voz.config ?? { proveedor: "local", modelo: "espeak-ng", nombre: "es-419" };
  const trabajo = await crearCarpetaTrabajo(`voz-${proyectoId}`);

  try {
    let nombreFinal: string;

    if (config.proveedor === "local") {
      // espeak-ng lee cualquier longitud de una vez: una sola llamada, una voz.
      nombreFinal = "voz-servidor.wav";
      await generarVoz(config, voz.texto, dir, 0);
      const { rename } = await import("node:fs/promises");
      await rename(join(dir, "voz0.wav"), join(dir, nombreFinal));
    } else {
      // Con IA se trocea por frases y se pega con ffmpeg, todo a 48 kHz.
      const trozos = trocear(voz.texto);
      const wavs: string[] = [];
      for (const [i, t] of trozos.entries()) {
        const bruto = await generarVoz(config, t, trabajo, i);
        const wav = `n${i}.wav`;
        await ffmpeg(["-i", bruto, "-ar", "48000", "-ac", "2", wav], trabajo);
        wavs.push(wav);
      }
      const { writeFile } = await import("node:fs/promises");
      await writeFile(join(trabajo, "lista.txt"), wavs.map((w) => `file '${w}'`).join("\n"));
      nombreFinal = "voz-servidor.wav";
      await ffmpeg(
        ["-f", "concat", "-safe", "0", "-i", "lista.txt", "-c", "copy", join(dir, nombreFinal)],
        trabajo,
      );
    }

    const duracion = await duracionAudio(join(dir, nombreFinal));
    return { archivo: nombreFinal, duracion, huella: huellaVoz(voz) };
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
