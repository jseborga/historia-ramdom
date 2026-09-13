import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generarVoz, limpiarMarcas } from "./voz.js";
import { huellaVoz, type VozPista } from "./proyecto.js";
import { ffmpeg, duracionAudio, concatenarWav } from "../render/ffmpeg.js";
import { crearCarpetaProyecto, crearCarpetaTrabajo, borrarCarpetaTemporal } from "../almacen.js";
import { enFila } from "../util/fila.js";
import { fragmentar } from "../render/rotulos.js";

/** Los proveedores de IA no admiten textos largos: se agrupan frases. */
const MAX_TROZO = 900;
/** Silencio entre frases al pegarlas. */
const PAUSA = 0.28;

export type Tramo = { texto: string; inicio: number; duracion: number };

/** Un envio al sintetizador: su texto y las frases que lleva dentro. */
type Trozo = { texto: string; frases: string[] };

/**
 * Con IA se agrupan frases hasta ~900 caracteres para no hacer cien llamadas,
 * pero se recuerda QUE frases van en cada grupo: sin eso, todo el texto
 * quedaria como un solo tramo y los rotulos perderian la sincronia.
 */
function agrupar(frases: string[]): Trozo[] {
  const salida: Trozo[] = [];
  let actual: Trozo | null = null;
  for (const f of frases) {
    if (actual && (actual.texto + " " + f).length > MAX_TROZO) {
      salida.push(actual);
      actual = { texto: f, frases: [f] };
    } else if (actual) {
      actual = { texto: `${actual.texto} ${f}`, frases: [...actual.frases, f] };
    } else {
      actual = { texto: f, frases: [f] };
    }
  }
  if (actual?.texto.trim()) salida.push(actual);
  return salida;
}

/**
 * Reparte el tiempo medido de un envio entre sus frases, en proporcion a lo
 * que cuesta leerlas. Con una frase por envio (voz local) es exacto; con
 * varias es una aproximacion, pero mucho mejor que un unico rotulo enorme.
 */
function tramosDeTrozo(trozo: Trozo, inicio: number, duracion: number): Tramo[] {
  const limpias = trozo.frases.map((f) => limpiarMarcas(f)).filter((f) => f);
  if (limpias.length <= 1) {
    return [{ texto: limpias[0] ?? limpiarMarcas(trozo.texto), inicio, duracion }];
  }
  const pesos = limpias.map((f) => Math.max(f.length, 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  let t = inicio;
  return limpias.map((texto, i) => {
    const largo = (duracion * pesos[i]) / total;
    const tramo = { texto, inicio: t, duracion: largo };
    t += largo;
    return tramo;
  });
}

/** Narraciones viejas del proyecto, para borrarlas cuando cambia el texto. */
const ES_NARRACION = /^voz-(servidor|[0-9a-f]{12})\.wav(\.json)?$/;

/** El nombre del archivo sale de la huella: el audio queda atado a SU texto y SU voz. */
export const nombreNarracion = (huella: string) => `voz-${huella.slice(0, 12)}.wav`;

/**
 * Genera la narracion con UNA sola voz, frase a frase, y devuelve ademas
 * donde empieza y cuanto dura cada frase en el audio final. Eso es lo que
 * hace que el texto pueda ir apareciendo exactamente cuando se lee.
 *
 * Dos garantias:
 *   - Una generacion por proyecto a la vez. Dos clics seguidos no lanzan dos
 *     tandas de peticiones ni se pisan el archivo a medio escribir.
 *   - El archivo se llama como la huella del texto y la voz, y se publica con
 *     un renombrado atomico: o esta entero, o no esta. Si ya existe el de esta
 *     misma huella, no se vuelve a pedir nada al proveedor.
 */
export async function generarNarracion(
  proyectoId: string,
  voz: VozPista,
  opciones: { forzar?: boolean } = {},
) {
  if (voz.modo !== "servidor") throw new Error("La narracion solo se genera en modo servidor");
  if (!voz.texto.trim()) throw new Error("La narracion esta vacia");

  const huella = huellaVoz(voz);
  const nombreFinal = nombreNarracion(huella);
  return enFila(`narracion:${proyectoId}`, () => generar(proyectoId, voz, huella, nombreFinal, opciones));
}

async function generar(
  proyectoId: string,
  voz: VozPista,
  huella: string,
  nombreFinal: string,
  opciones: { forzar?: boolean },
) {
  const dir = await crearCarpetaProyecto(proyectoId);
  const destinoFinal = join(dir, nombreFinal);

  // Ya generado con este mismo texto y esta misma voz: se reutiliza tal cual,
  // aunque quien pregunte no traiga los tramos (dos clics seguidos, el render
  // justo despues del editor...). Los tiempos viven en un JSON al lado del wav.
  if (!opciones.forzar) {
    const hecho = await stat(destinoFinal).then((x) => x.size > 1000, () => false);
    if (hecho) {
      const guardado = await leerMedidas(destinoFinal);
      const tramos = voz.huella === huella && voz.tramos.length ? voz.tramos : guardado?.tramos;
      if (tramos?.length) {
        return {
          archivo: nombreFinal,
          duracion: guardado?.duracion ?? voz.duracion ?? (await duracionAudio(destinoFinal)),
          huella,
          tramos,
          /** No se ha pedido nada al proveedor: estaba hecho. */
          reutilizada: true,
        };
      }
    }
  }

  const config = voz.config ?? { proveedor: "local" as const, modelo: "espeak-ng", nombre: "es-419" };
  const trabajo = await crearCarpetaTrabajo(`voz-${proyectoId}`);
  const frases = fragmentar(voz.texto, "frases");
  const trozos: Trozo[] =
    config.proveedor === "local" ? frases.map((f) => ({ texto: f, frases: [f] })) : agrupar(frases);
  // Se escribe aparte y solo al final se pone el nombre bueno: si algo falla a
  // mitad, el proyecto se queda con la narracion anterior, no con media.
  const parcial = join(dir, `${nombreFinal}.parcial`);

  try {
    const generados: string[] = [];
    for (const [i, t] of trozos.entries()) {
      const bruto = await generarVoz(config, t.texto, trabajo, i);
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
      const r = await concatenarWav(generados, parcial, PAUSA);
      // Los rotulos no deben mostrar las marcas de tono: se quitan del texto.
      tramos = trozos.flatMap((t, i) => tramosDeTrozo(t, r.inicios[i], r.duraciones[i]));
      duracion = r.total;
    } catch {
      // Formatos distintos entre trozos (raro): lo pega ffmpeg y se miden aparte.
      await writeFile(join(trabajo, "lista.txt"), generados.map((g) => `file '${g}'`).join("\n"));
      await ffmpeg(["-f", "concat", "-safe", "0", "-i", "lista.txt", "-ar", "48000", "-ac", "2", parcial], trabajo);
      const duraciones = await Promise.all(generados.map((g) => duracionAudio(g)));
      let t = 0;
      tramos = trozos.flatMap((trozo, i) => {
        const partes = tramosDeTrozo(trozo, t, duraciones[i]);
        t += duraciones[i];
        return partes;
      });
      duracion = await duracionAudio(parcial);
    }

    // Publicacion atomica: hasta aqui el proyecto seguia con lo que tuviera.
    await rename(parcial, destinoFinal);
    await guardarMedidas(destinoFinal, duracion, tramos);
    await limpiarNarracionesViejas(dir, nombreFinal);

    return { archivo: nombreFinal, duracion, huella, tramos, reutilizada: false };
  } finally {
    await rm(parcial, { force: true }).catch(() => {});
    await borrarCarpetaTemporal(trabajo);
  }
}

/**
 * Los tiempos de cada frase, al lado del audio. Sin esto, reutilizar un
 * archivo ya generado obligaria a volver a pedirlo solo para saber donde cae
 * cada rotulo.
 */
const rutaMedidas = (audio: string) => `${audio}.json`;

async function guardarMedidas(audio: string, duracion: number, tramos: Tramo[]) {
  await writeFile(rutaMedidas(audio), JSON.stringify({ duracion, tramos }), "utf8").catch(() => {});
}

async function leerMedidas(audio: string): Promise<{ duracion: number; tramos: Tramo[] } | null> {
  try {
    const datos = JSON.parse(await readFile(rutaMedidas(audio), "utf8"));
    return Array.isArray(datos?.tramos) && datos.tramos.length ? datos : null;
  } catch {
    return null;
  }
}

/** Borra las narraciones anteriores del proyecto; la voz subida no se toca. */
async function limpiarNarracionesViejas(dir: string, actual: string) {
  const archivos = await readdir(dir).catch(() => [] as string[]);
  for (const f of archivos) {
    // La narracion actual y SU json de tiempos se quedan; lo demas sobra.
    if (f === actual || f === rutaMedidas(actual)) continue;
    if (ES_NARRACION.test(f)) await rm(join(dir, f), { force: true }).catch(() => {});
  }
}

/** Solo para comprobar que el archivo sigue ahi antes de renderizar. */
export async function narracionExiste(proyectoId: string, archivo: string) {
  return readFile(join(await crearCarpetaProyecto(proyectoId), archivo))
    .then(() => true)
    .catch(() => false);
}

export { rename as _renombrar };
