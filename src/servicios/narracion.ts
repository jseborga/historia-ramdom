import { readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generarVoz, limpiarMarcas, cabeEnGeminiDialogo, vozGeminiDialogo } from "./voz.js";
import { huellaVoz, type VozPista } from "./proyecto.js";
import { ffmpeg, duracionAudio, concatenarWav } from "../render/ffmpeg.js";
import { silencios, repartirPorSilencios } from "../render/audio.js";
import { crearCarpetaProyecto, crearCarpetaTrabajo, borrarCarpetaTemporal } from "../almacen.js";
import { enFila } from "../util/fila.js";
import { fragmentar } from "../render/rotulos.js";

/** Los proveedores de IA no admiten textos largos: se agrupan frases. */
const MAX_TROZO = 900;
/** Silencio entre frases al pegarlas. */
const PAUSA = 0.28;
/** Entre una intervención y la siguiente hace falta más aire que entre frases. */
const PAUSA_DIALOGO = 0.45;

export type Tramo = { texto: string; inicio: number; duracion: number; hablante?: number };

/** Marca los tramos de un trozo con quién los dice (solo en diálogos). */
const conHablante = (tramos: Tramo[], trozo: { hablante?: number }): Tramo[] =>
  trozo.hablante === undefined ? tramos : tramos.map((t) => ({ ...t, hablante: trozo.hablante }));

/**
 * Un envio al sintetizador: su texto, las frases que lleva dentro y con qué
 * voz se lee. En una narración normal la voz es la misma para todos; en un
 * diálogo, cada intervención trae la de quien habla.
 */
type Trozo = { texto: string; frases: string[]; config?: unknown; hablante?: number };

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
  if (voz.modo !== "servidor" && voz.modo !== "dialogo") {
    throw new Error("La narracion solo se genera en modo servidor o dialogo");
  }
  if (voz.modo === "dialogo") {
    if (!voz.hablantes.length) throw new Error("El dialogo no tiene voces");
    if (!voz.dialogo.length) throw new Error("El dialogo esta vacio");
  } else if (!voz.texto.trim()) {
    throw new Error("La narracion esta vacia");
  }

  const huella = huellaVoz(voz);
  const nombreFinal = nombreNarracion(huella);
  return enFila(`narracion:${proyectoId}`, () => generar(proyectoId, voz, huella, nombreFinal, opciones));
}

/**
 * La conversación entera en una sola petición a Gemini, y los tiempos de cada
 * turno sacados de las pausas del propio audio.
 *
 * Los rótulos tienen que caer donde suena cada réplica: con un archivo por
 * intervención eso era gratis, aquí hay que medirlo. Si las pausas no dan
 * (voces que se solapan, una charla sin aire), se reparte proporcionalmente a
 * lo que ocupa cada texto: menos exacto, pero nunca deja un rótulo colgado.
 */
async function generarDialogoDeUnaVez(
  voz: VozPista,
  dir: string,
  nombreFinal: string,
  huella: string,
  idioma: string,
) {
  const trabajo = await crearCarpetaTrabajo(`voz-dialogo-${nombreFinal}`);
  const parcial = join(dir, `${nombreFinal}.parcial`);
  try {
    const crudo = join(trabajo, "conversacion.wav");
    await vozGeminiDialogo(
      voz.dialogo,
      voz.hablantes.map((h) => ({ nombre: h.nombre, config: h.config })),
      crudo,
      voz.hablantes[0]?.config?.modelo,
      idioma,
    );
    // Al formato de la app, como el resto de la voz de IA.
    await ffmpeg(["-i", crudo, "-ar", "48000", "-ac", "2", "-f", "wav", parcial], trabajo);

    const duracion = await duracionAudio(parcial);
    const pausas = await silencios(parcial).catch(() => []);
    const reparto = repartirPorSilencios(voz.dialogo.map((d) => d.texto), duracion, pausas);

    // Dentro de cada turno, las frases se reparten por su largo: así un rótulo
    // no se come dos réplicas.
    const tramos: Tramo[] = voz.dialogo.flatMap((d, i) =>
      conHablante(
        tramosDeTrozo(
          { texto: d.texto, frases: fragmentar(d.texto, "frases") },
          reparto[i].inicio,
          reparto[i].duracion,
        ),
        { hablante: d.hablante },
      ),
    );

    await rename(parcial, join(dir, nombreFinal));
    await guardarMedidas(join(dir, nombreFinal), duracion, tramos);
    await limpiarNarracionesViejas(dir, nombreFinal);
    return { archivo: nombreFinal, duracion, huella, tramos, reutilizada: false };
  } finally {
    await rm(parcial, { force: true }).catch(() => {});
    await borrarCarpetaTemporal(trabajo);
  }
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
  // El idioma de la pista: con él se le pide el tono a la voz de IA (narrar en
  // español un texto en inglés sale con acento de nadie).
  const idioma = voz.idioma ?? "es";
  const trabajo = await crearCarpetaTrabajo(`voz-${proyectoId}`);
  const esDialogo = voz.modo === "dialogo";

  // Un diálogo pedido turno a turno suena a dos monólogos alternos: cada
  // intervención se graba sin haber oído la anterior. Gemini admite la
  // conversación entera en una sola petición (dos voces como mucho), y ahí sí
  // hay reacción y ritmo. A cambio vuelve un solo archivo: dónde empieza cada
  // turno se mide después, por las pausas.
  if (esDialogo && voz.vozNatural !== false && cabeEnGeminiDialogo(voz.hablantes)) {
    try {
      return await generarDialogoDeUnaVez(voz, dir, nombreFinal, huella, idioma);
    } catch (err) {
      // Si falla (cuota, modelo sin multivoz, dos voces iguales), se sigue por
      // el camino de siempre en vez de dejar al usuario sin narración.
      console.warn(
        `La conversación entera con Gemini no salió (${err instanceof Error ? err.message : err}); se graba turno a turno.`,
      );
    }
  }
  // En un diálogo cada intervención va aparte aunque sea corta: la voz cambia
  // de una a otra, así que no se pueden agrupar. Dentro de cada una sí se
  // reparten las frases para que los rótulos caigan donde suenan.
  const trozos: Trozo[] = esDialogo
    ? voz.dialogo.map((d) => ({
        texto: d.texto,
        frases: fragmentar(d.texto, "frases"),
        config: voz.hablantes[d.hablante]?.config ?? config,
        hablante: d.hablante,
      }))
    : config.proveedor === "local"
      ? fragmentar(voz.texto, "frases").map((f) => ({ texto: f, frases: [f] }))
      : agrupar(fragmentar(voz.texto, "frases"));
  // Se escribe aparte y solo al final se pone el nombre bueno: si algo falla a
  // mitad, el proyecto se queda con la narracion anterior, no con media.
  const parcial = join(dir, `${nombreFinal}.parcial`);

  try {
    const generados: string[] = [];
    for (const [i, t] of trozos.entries()) {
      const suya = (t.config ?? config) as { proveedor: string };
      const bruto = await generarVoz(suya, t.texto, trabajo, i, idioma);
      // Las voces locales ya dan WAV, pero cada una con su cadencia: en un
      // diálogo se mezclan dos o tres y hay que igualarlas antes de pegarlas.
      if (suya.proveedor === "local" && !esDialogo) {
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
      const r = await concatenarWav(generados, parcial, esDialogo ? PAUSA_DIALOGO : PAUSA);
      // Los rotulos no deben mostrar las marcas de tono: se quitan del texto.
      tramos = trozos.flatMap((t, i) => conHablante(tramosDeTrozo(t, r.inicios[i], r.duraciones[i]), t));
      duracion = r.total;
    } catch {
      // Formatos distintos entre trozos (raro): lo pega ffmpeg y se miden aparte.
      await writeFile(join(trabajo, "lista.txt"), generados.map((g) => `file '${g}'`).join("\n"));
      // `-f wav` a la fuerza: el archivo se llama `.parcial` (se renombra al
      // final) y ffmpeg no sabe adivinar el formato por la extensión.
      await ffmpeg(
        ["-f", "concat", "-safe", "0", "-i", "lista.txt", "-ar", "48000", "-ac", "2", "-f", "wav", parcial],
        trabajo,
      );
      const duraciones = await Promise.all(generados.map((g) => duracionAudio(g)));
      let t = 0;
      tramos = trozos.flatMap((trozo, i) => {
        const partes = conHablante(tramosDeTrozo(trozo, t, duraciones[i]), trozo);
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
