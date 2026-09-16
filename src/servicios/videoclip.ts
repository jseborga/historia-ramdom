import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import { duracionAudio } from "../render/ffmpeg.js";
import { energiaPorSegundo, mejoresMomentos, type Momento, type TramoLetra } from "../render/audio.js";
import { MAX_DURACION_SEG, movimientoPorIndice } from "../render/presets.js";
import { env } from "../env.js";
import { ESTILO_POR_DEFECTO } from "../render/rotulos.js";
import { rutaSubidaSegura, rutaMusicaSegura } from "../almacen.js";
import { buscarClips, CLIP_LARGO, type ClipInfo, type OpcionesMedios } from "./clips.js";
import { extraerJSON, textoConMotor, esMotor, motorDisponible, ORTOGRAFIA, type Motor } from "./guion.js";
import {
  ClipPistaSchema,
  RotuloPistaSchema,
  MusicaCapaSchema,
  type ClipPista,
  type RotuloPista,
} from "./proyecto.js";

/**
 * Videoclip musical: la MUSICA manda, igual que la narracion mandaba en las
 * historias. No hay voz en off; la letra (o unos lineamientos, si el tema es
 * instrumental) decide que se ve en cada tramo de la cancion.
 *
 * Se reusa el mismo motor de edicion: tres pistas sobre el mismo tiempo. Solo
 * cambia quien gobierna la duracion y de donde salen los criterios de imagen.
 */

/** Un tramo de la cancion: intro, verso, coro... con lo que debe verse en el. */
export const SeccionSchema = z.object({
  etiqueta: z.string().min(1).max(40),
  /** Lineas de la letra de este tramo; vacio en instrumentales. */
  texto: z.string().max(4000).default(""),
  /** Peso relativo del tramo dentro de la cancion (proporcion del tiempo). */
  peso: z.number().min(0.2).max(50).default(1),
  /** El coro o el momento fuerte: de aqui salen los cortes para redes. */
  destacada: z.boolean().default(false),
  /** Criterios de busqueda de clips EN INGLES para este tramo. */
  keywords: z.array(z.string().min(1).max(40)).min(1).max(4),
  /**
   * Descripcion larga EN INGLES de la imagen de este tramo, lista para pegar
   * en un generador de imagenes (o para buscar a mano algo mas fino que las
   * palabras clave).
   */
  prompt: z.string().max(500).default(""),
});

export type Seccion = z.infer<typeof SeccionSchema>;

export const LetraSchema = z.object({
  instrumental: z.boolean().default(false),
  titulo: z.string().max(120).default(""),
  /** La letra tal cual la pego el usuario (con sus etiquetas de Suno si las trae). */
  texto: z.string().max(20_000).default(""),
  /** Instrucciones del usuario: estilo visual, que buscar, que evitar. */
  lineamientos: z.string().max(2000).default(""),
  /** En que idioma esta la letra: manda en el analisis y en los rotulos. */
  idioma: z.enum(["es", "en"]).default("es"),
  /** Como debe verse el videoclip entero, en una frase. */
  estiloVisual: z.string().max(300).default(""),
  /** Quemar la letra sobre el video. Se recuerda para los montajes siguientes. */
  mostrarLetra: z.boolean().default(true),
  secciones: z.array(SeccionSchema).max(40).default([]),
  /** Criterios generales de imagen, para todo el videoclip. */
  keywords: z.array(z.string().max(40)).max(10).default([]),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
});

export type Letra = z.infer<typeof LetraSchema>;

/** Lo que se guarda en `Proyecto.letra`. */
export const esLetra = (v: unknown): Letra | null => {
  const r = LetraSchema.safeParse(v);
  return r.success ? r.data : null;
};

// ---- Analisis de la letra ----

/** Etiquetas de seccion al estilo de Suno: [Verse 1], [Chorus], [Puente]... */
const ETIQUETA = /^\s*[[(]([^\]\)]{1,40})[\])]\s*$/;

const CORO = /(chorus|coro|estribillo|hook|drop)/i;

/**
 * Reparto sin IA: se parte la letra por sus etiquetas (o por lineas en
 * blanco) y las palabras largas de cada tramo hacen de criterio de busqueda.
 * Es el plan B para que un videoclip salga igual sin ningun motor configurado.
 */
export function seccionesHeuristicas(letra: string): Seccion[] {
  const bloques: { etiqueta: string; lineas: string[] }[] = [];
  let actual = { etiqueta: "Parte 1", lineas: [] as string[] };

  for (const linea of letra.split("\n")) {
    const et = ETIQUETA.exec(linea);
    if (et) {
      if (actual.lineas.length) bloques.push(actual);
      actual = { etiqueta: et[1].trim(), lineas: [] };
      continue;
    }
    if (!linea.trim()) {
      if (actual.lineas.length) {
        bloques.push(actual);
        actual = { etiqueta: `Parte ${bloques.length + 1}`, lineas: [] };
      }
      continue;
    }
    actual.lineas.push(linea.trim());
  }
  if (actual.lineas.length) bloques.push(actual);

  return bloques.map((b) =>
    SeccionSchema.parse({
      etiqueta: b.etiqueta,
      texto: b.lineas.join("\n"),
      peso: Math.max(b.lineas.length, 1),
      destacada: CORO.test(b.etiqueta),
      keywords: palabrasVisuales(b.lineas.join(" ")),
    }),
  );
}

const VACIAS = new Set(
  ("de la el los las un una y o que en a por para con sin es son se su sus al del lo le mi tu yo me te " +
   "the a an of to in on and or is are was were for with at by from this that it as be my your i you").split(" "),
);

function palabrasVisuales(texto: string): string[] {
  const ws = texto
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 5 && !VACIAS.has(w));
  const unicas = [...new Set(ws)].slice(0, 2);
  return unicas.length ? unicas : ["cinematic abstract"];
}

/** Tramos de un instrumental cuando no hay ni IA ni lineamientos utiles. */
function seccionesInstrumentales(duracion: number, lineamientos: string): Seccion[] {
  const cuantas = Math.max(3, Math.min(12, Math.round(duracion / 20)));
  const base = palabrasVisuales(lineamientos);
  return Array.from({ length: cuantas }, (_, i) =>
    SeccionSchema.parse({
      etiqueta: `Tramo ${i + 1}`,
      peso: 1,
      destacada: i === Math.floor(cuantas / 2),
      keywords: base,
    }),
  );
}

export type PeticionLetra = {
  /** La letra pegada; vacia en instrumentales. */
  letra?: string;
  /** Indicaciones del usuario: ambiente, que buscar, que evitar. */
  lineamientos?: string;
  instrumental?: boolean;
  /** Quemar la letra sobre el video; viaja con el analisis para no perderse. */
  mostrarLetra?: boolean;
  /** Titulo que ya puso el usuario; el modelo solo lo rellena si falta. */
  titulo?: string;
  /** Duracion real de la cancion, para saber cuantos tramos pedir. */
  duracion: number;
  idioma?: string;
  motor?: string | null;
  modelo?: string | null;
};

/**
 * Convierte la letra (o los lineamientos) en tramos con criterios de imagen.
 * Si no hay motor de IA o falla, se cae a la version heuristica: el videoclip
 * sale igual, solo que las busquedas son menos finas.
 */
export async function analizarLetra(p: PeticionLetra): Promise<Letra> {
  const letra = (p.letra ?? "").trim();
  const lineamientos = (p.lineamientos ?? "").trim();
  const instrumental = p.instrumental ?? !letra;
  if (!instrumental && !letra) throw new Error("Pega la letra o marca la cancion como instrumental");
  if (instrumental && !lineamientos) {
    throw new Error("Sin letra hacen falta lineamientos: di que quieres ver en el videoclip");
  }

  const elegido = (p.motor && esMotor(p.motor) ? p.motor : null) ?? motorDisponible();
  const respaldo = (): Letra =>
    LetraSchema.parse({
      instrumental,
      texto: letra,
      lineamientos,
      mostrarLetra: p.mostrarLetra ?? true,
      titulo: p.titulo ?? "",
      secciones: instrumental ? seccionesInstrumentales(p.duracion, lineamientos) : seccionesHeuristicas(letra),
      keywords: palabrasVisuales(lineamientos || letra),
    });
  if (!elegido) return respaldo();

  const tramos = Math.max(4, Math.min(20, Math.round(p.duracion / 18)));
  const prompt = [
    instrumental
      ? `Planifica las imagenes de un videoclip para una cancion INSTRUMENTAL de ${Math.round(p.duracion)} segundos.`
      : `Planifica las imagenes de un videoclip de ${Math.round(p.duracion)} segundos a partir de su LETRA.`,
    "El video se monta con clips de archivo (Pexels y Pixabay) que se buscan por palabras clave en INGLES.",
    instrumental
      ? `Divide la cancion en unos ${tramos} tramos y da para cada uno que deberia verse.`
      : "Respeta los tramos de la letra (intro, versos, coros, puente, cierre). Si la letra trae etiquetas " +
        "entre corchetes, usalas como tramos; si no, agrupa por estrofas.",
    lineamientos ? `Indicaciones del autor, mandan sobre todo lo demas: ${lineamientos}` : "",
    "Marca como destacada la seccion mas fuerte (el coro o el clímax): de ahi saldra el corte de 30 segundos para redes.",
    "El peso es cuanto dura ese tramo comparado con los demas (un coro pesa mas que una intro).",
    ORTOGRAFIA,
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "titulo": "titulo corto de la cancion",',
    '  "estiloVisual": "como se ve el videoclip entero, en una frase",',
    '  "keywords": ["visual keyword in english", "another"],',
    '  "hashtags": ["sinAlmohadilla", "otro"],',
    '  "secciones": [',
    '    { "etiqueta": "Coro", "texto": "las lineas de la letra de este tramo", "peso": 2,',
    '      "destacada": true, "keywords": ["neon city night", "crowd dancing"],',
    '      "prompt": "descripcion larga en ingles de la imagen de este tramo" }',
    "  ]",
    "}",
    'En instrumentales deja "texto" vacio. Las keywords son de 1 a 3 por tramo, concretas y visuales.',
    "El `prompt` es una frase larga EN INGLES que describa el plano de ese tramo (encuadre, luz, " +
      "colores, movimiento de camara, ambiente), para generar la imagen con IA o buscarla a mano.",
    "",
    instrumental ? `INDICACIONES: ${lineamientos}` : `LETRA:\n${letra.slice(0, 8000)}`,
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const crudo = await textoConMotor(elegido as Motor, prompt, p.modelo, p.idioma ?? "es");
    const datos = extraerJSON(crudo) as Record<string, unknown>;
    const letraFinal = LetraSchema.parse({
      ...datos,
      instrumental,
      texto: letra,
      lineamientos,
      mostrarLetra: p.mostrarLetra ?? true,
      // El titulo del usuario manda sobre el que invente el modelo.
      titulo: p.titulo?.trim() || datos.titulo || "",
    });
    if (!letraFinal.secciones.length) return respaldo();
    // Si el modelo no marco ninguna destacada, se toma la de mas peso.
    if (!letraFinal.secciones.some((s) => s.destacada)) {
      const mayor = letraFinal.secciones.reduce((a, b) => (b.peso > a.peso ? b : a));
      mayor.destacada = true;
    }
    return letraFinal;
  } catch {
    return respaldo();
  }
}

/** Lo que devuelve la ayuda de IA para describir el videoclip. */
export const SugerenciaSchema = z.object({
  /** Parrafo para el campo de lineamientos: ambiente, colores, planos, que evitar. */
  lineamientos: z.string().min(10).max(2000),
  /** Como se ve el videoclip entero, en una frase. */
  estiloVisual: z.string().max(300).default(""),
  /** Criterios de busqueda de clips EN INGLES. */
  keywords: z.array(z.string().min(1).max(40)).max(10).default([]),
  /** Descripcion larga EN INGLES para generar imagenes del videoclip. */
  prompt: z.string().max(600).default(""),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
});

export type Sugerencia = z.infer<typeof SugerenciaSchema>;

/**
 * Ayuda de IA para describir el videoclip ANTES de montarlo: a partir de la
 * letra (o de cuatro palabras sueltas) propone el ambiente, los criterios de
 * busqueda en ingles y un prompt largo para generar imagenes. No guarda nada:
 * se revisa, se corrige y se guarda desde el editor.
 */
export async function sugerirLineamientos(p: {
  letra?: string;
  /** Lo poco que ya haya escrito el usuario; la propuesta parte de ahi. */
  lineamientos?: string;
  instrumental?: boolean;
  titulo?: string;
  duracion?: number;
  idioma?: string;
  motor?: string | null;
  modelo?: string | null;
}): Promise<Sugerencia> {
  const elegido = (p.motor && esMotor(p.motor) ? p.motor : null) ?? motorDisponible();
  if (!elegido) {
    throw new Error(
      "No hay ningun motor de IA configurado: añade una clave de Groq, Gemini, OpenAI o Claude en el entorno",
    );
  }
  const letra = (p.letra ?? "").trim();
  const instrumental = p.instrumental ?? !letra;
  if (!letra && !(p.lineamientos ?? "").trim() && !(p.titulo ?? "").trim()) {
    throw new Error("Escribe al menos el titulo, una idea o la letra para que la IA proponga algo");
  }

  const prompt = [
    "Eres director de fotografia de videoclips. Describe COMO SE VE el videoclip de esta cancion.",
    p.titulo ? `Titulo: ${p.titulo}.` : "",
    p.duracion ? `Dura unos ${Math.round(p.duracion)} segundos.` : "",
    instrumental ? "La cancion es instrumental." : "",
    (p.lineamientos ?? "").trim()
      ? `El autor ya apunto esto y hay que respetarlo y ampliarlo: ${p.lineamientos}`
      : "",
    "El video se monta con clips de archivo (Pexels y Pixabay) y, si el autor quiere, con imagenes",
    "generadas por IA. Asi que hacen falta las dos cosas: palabras de busqueda cortas EN INGLES y",
    "un prompt largo EN INGLES para generar imagenes.",
    "Nada de personas reales identificables, marcas ni logotipos.",
    ORTOGRAFIA,
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "lineamientos": "parrafo en español: ambiente, paleta de color, tipo de planos, ritmo y que evitar",',
    '  "estiloVisual": "una frase que resuma el look",',
    '  "keywords": ["visual keyword in english", "another"],',
    '  "prompt": "long english prompt for an image generator: subject, framing, light, color, mood, lens",',
    '  "hashtags": ["sinAlmohadilla", "otro"]',
    "}",
    "",
    letra ? `LETRA:\n${letra.slice(0, 6000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const crudo = await textoConMotor(elegido as Motor, prompt, p.modelo, p.idioma ?? "es");
  if (!crudo) throw new Error(`El motor ${elegido} no devolvio contenido`);
  return SugerenciaSchema.parse(extraerJSON(crudo));
}

/** Los prompts de imagen de cada tramo, listos para copiar o descargar. */
export function promptsDeLetra(letra: Letra, partes: { titulo: string; inicio: number }[] = []): string {
  const cabecera = [
    letra.titulo ? `# ${letra.titulo}` : "# Videoclip",
    letra.estiloVisual ? `Estilo: ${letra.estiloVisual}` : "",
    letra.keywords.length ? `Búsqueda general: ${letra.keywords.join(", ")}` : "",
    partes.length > 1 ? `Canciones: ${partes.map((p) => p.titulo).join(" · ")}` : "",
    "",
  ].filter(Boolean);

  const cuerpo = letra.secciones.map((s, i) =>
    [
      `${i + 1}. ${s.etiqueta}${s.destacada ? " (momento fuerte)" : ""}`,
      `   Búsqueda: ${s.keywords.join(", ")}`,
      s.prompt ? `   Imagen: ${s.prompt}` : "",
      s.texto.trim() ? `   Letra: ${s.texto.replace(/\n/g, " / ")}` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  return [...cabecera, ...cuerpo].join("\n");
}

// ---- Montaje ----

/** Donde empieza y cuanto dura cada seccion dentro de la cancion. */
export function repartirSecciones(secciones: Seccion[], total: number): TramoLetra[] {
  const pesos = secciones.map((s) => Math.max(s.peso, 0.2));
  const suma = pesos.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return secciones.map((s, i) => {
    // El ultimo cierra exactamente al final: los redondeos no dejan hueco.
    const duracion = i === secciones.length - 1 ? Math.max(total - t, 0.5) : (total * pesos[i]) / suma;
    const tramo = { etiqueta: s.etiqueta, inicio: t, duracion, destacada: s.destacada };
    t += duracion;
    return tramo;
  });
}

/**
 * Llena un tramo con clips al azar, cada uno con su duracion real de origen y
 * sin repetir mientras haya de donde elegir. En un videoclip la imagen puede
 * cambiar mas a menudo que en una historia, asi que se acota cada plano.
 */
export function rellenarTramo(
  candidatos: ClipInfo[],
  duracion: number,
  usados: Set<string>,
  maximoPlano = 12,
): ClipPista[] {
  const salida: ClipPista[] = [];
  let cubierto = 0;
  const barajados = [...candidatos].sort(() => Math.random() - 0.5);
  let vuelta = 0;

  /** Lo que falta por cubrir se lo queda el ultimo plano: nunca se pasa del tramo. */
  const estirarUltimo = (resto: number) => {
    const ultimo = salida.at(-1);
    if (!ultimo) return false;
    ultimo.duracion += resto;
    // Si el clip de origen se queda corto, se empieza antes en vez de repetirlo.
    const origen = ultimo.clip?.duracion;
    if (origen && ultimo.recorte + ultimo.duracion > origen) {
      ultimo.recorte = Math.max(0, origen - ultimo.duracion);
    }
    cubierto += resto;
    return true;
  };

  while (cubierto < duracion - 0.05 && vuelta < 4) {
    let avanzo = false;
    for (const c of barajados) {
      const resto = duracion - cubierto;
      if (resto < 0.05) break;
      if (usados.has(c.id) && vuelta === 0) continue;
      // Un plano de menos de segundo y medio es un parpadeo: mejor alargar el anterior.
      if (resto < 1.5 && estirarUltimo(resto)) break;

      const real = c.duracion && c.duracion > 0 ? c.duracion : maximoPlano;
      const largo = Math.min(real, maximoPlano, resto);
      // De un clip largo se aprovecha un trozo distinto cada vez que vuelve.
      const margen = Math.max(0, real - largo);
      salida.push(
        ClipPistaSchema.parse({
          id: randomUUID(),
          clip: c,
          duracion: largo,
          recorte: margen > 0.5 ? Math.random() * margen : 0,
          efecto: c.tipo === "imagen" ? movimientoPorIndice(salida.length) : salida.length % 3 === 0 ? "zoomLento" : "ninguno",
        }),
      );
      usados.add(c.id);
      cubierto += largo;
      avanzo = true;
    }
    if (!avanzo) break;
    vuelta++;
  }

  // Sin clips (o sin suficientes) queda fondo de color: el tramo nunca sale vacio.
  const resto = duracion - cubierto;
  if (resto > 0.05) {
    if (salida.length && resto < 1.5) estirarUltimo(resto);
    else salida.push(ClipPistaSchema.parse({ id: randomUUID(), duracion: Math.max(0.5, resto) }));
  }
  return salida;
}

/** Parte la letra de un tramo en rotulos de una o dos lineas. */
export function rotulosDeSeccion(
  texto: string,
  inicio: number,
  duracion: number,
  porRotulo = 2,
): RotuloPista[] {
  const lineas = texto
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !ETIQUETA.test(l));
  if (!lineas.length) return [];

  const grupos: string[] = [];
  for (let i = 0; i < lineas.length; i += porRotulo) {
    grupos.push(lineas.slice(i, i + porRotulo).join("\n"));
  }
  const pesos = grupos.map((g) => Math.max(g.split(/\s+/).length, 1));
  const suma = pesos.reduce((a, b) => a + b, 0) || 1;
  let t = inicio;
  return grupos.map((texto, i) => {
    const largo = Math.max((duracion * pesos[i]) / suma, 0.4);
    const r = RotuloPistaSchema.parse({
      id: randomUUID(),
      inicio: t,
      duracion: largo,
      texto,
      estilo: { ...ESTILO_POR_DEFECTO, tamano: 62, posicion: "abajo", negrita: true },
      animacion: "fundido",
      lectura: "todo",
    });
    t += largo;
    return r;
  });
}

/**
 * Guarda la configuracion del videoclip (letra, lineamientos, si es
 * instrumental y si la letra se quema) SIN montar nada. Lo que no venga se
 * queda como estaba: es lo que permite escribir la letra, cerrar, y seguir
 * despues sin perder nada.
 */
export async function guardarLetra(
  proyectoId: string,
  cambios: {
    letra?: string;
    lineamientos?: string;
    instrumental?: boolean;
    mostrarLetra?: boolean;
    titulo?: string;
    idioma?: "es" | "en";
  },
): Promise<Letra> {
  const p = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const guardada = esLetra(p.letra);
  const texto = cambios.letra ?? guardada?.texto ?? "";
  const lineamientos = cambios.lineamientos ?? guardada?.lineamientos ?? "";
  // Si cambia el texto de partida, los tramos viejos ya no valen.
  const cambio = texto !== (guardada?.texto ?? "") || lineamientos !== (guardada?.lineamientos ?? "");

  const letra = LetraSchema.parse({
    ...(guardada ?? {}),
    texto,
    lineamientos,
    instrumental: cambios.instrumental ?? guardada?.instrumental ?? !texto.trim(),
    mostrarLetra: cambios.mostrarLetra ?? guardada?.mostrarLetra ?? true,
    titulo: cambios.titulo ?? guardada?.titulo ?? "",
    idioma: cambios.idioma ?? guardada?.idioma ?? "es",
    secciones: cambio ? [] : (guardada?.secciones ?? []),
  });
  await db.proyecto.update({ where: { id: proyectoId }, data: { letra } });
  return letra;
}

export type OpcionesVideoclip = {
  letra?: string;
  lineamientos?: string;
  instrumental?: boolean;
  /** Quemar la letra en el video; en instrumentales se ignora. */
  mostrarLetra?: boolean;
  idioma?: string;
  motor?: string | null;
  modelo?: string | null;
  /** Volver a analizar la letra aunque el proyecto ya tenga el analisis. */
  reanalizar?: boolean;
  /** Dónde buscar la imagen y si entran fotos; vacío = vídeo de siempre. */
  medios?: OpcionesMedios;
};

/** Segundos que puede durar un videoclip; nunca menos que el tope general. */
export const topeVideoclip = () => Math.max(env.MAX_VIDEOCLIP_SEG, MAX_DURACION_SEG);

/** Ruta real del archivo de musica del proyecto, este subido o en la biblioteca. */
export function rutaMusicaDeProyecto(proyectoId: string, musica: { archivo: string | null; subida: boolean }) {
  if (!musica.archivo) throw new Error("El proyecto no tiene musica: añade un enlace de Suno o sube un archivo");
  return musica.subida ? rutaSubidaSegura(proyectoId, musica.archivo) : rutaMusicaSegura(musica.archivo);
}

/**
 * Monta el videoclip entero:
 *   1. mide la cancion (ella decide cuanto dura el video),
 *   2. reparte sus tramos segun la letra o los lineamientos,
 *   3. busca clips con los criterios de cada tramo y llena la imagen,
 *   4. si se pide, quema la letra donde toca.
 */
export async function montarVideoclip(proyectoId: string, opciones: OpcionesVideoclip = {}) {
  const p = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const musica = MusicaCapaSchema.parse(p.musica ?? {});
  const ruta = rutaMusicaDeProyecto(proyectoId, musica);

  const duracionCancion = await duracionAudio(ruta);
  if (!Number.isFinite(duracionCancion) || duracionCancion < 1) {
    throw new Error("No se pudo medir la cancion");
  }
  // Un videoclip puede encadenar varias canciones, asi que tiene su propio
  // tope (MAX_VIDEOCLIP_SEG), mas largo que el de las historias.
  const total = Math.min(duracionCancion, topeVideoclip());

  // La configuracion vive en el proyecto: lo que llegue en las opciones solo
  // la pisa campo a campo, asi el boton de "volver a montar" no necesita
  // reenviar la letra entera.
  const guardada = esLetra(p.letra);
  const texto = opciones.letra ?? guardada?.texto ?? "";
  const lineamientos = opciones.lineamientos ?? guardada?.lineamientos ?? "";
  const sirveLoGuardado =
    !opciones.reanalizar &&
    guardada?.secciones.length &&
    texto === guardada.texto &&
    lineamientos === guardada.lineamientos;

  const letra = sirveLoGuardado
    ? { ...guardada, mostrarLetra: opciones.mostrarLetra ?? guardada.mostrarLetra }
    : await analizarLetra({
        letra: texto,
        lineamientos,
        instrumental: opciones.instrumental ?? guardada?.instrumental,
        mostrarLetra: opciones.mostrarLetra ?? guardada?.mostrarLetra ?? true,
        titulo: guardada?.titulo || p.nombre,
        duracion: total,
        idioma: opciones.idioma,
        motor: opciones.motor,
        modelo: opciones.modelo,
      });

  // Con varias canciones, cada una reparte SUS tramos dentro de su hueco: la
  // letra de la segunda no se estira sobre la primera.
  const partes = musica.partes.filter((x) => x.inicio < total - 0.5);
  const conLetraPropia = partes.filter((x) => x.letra.trim()).length > 0;

  let secciones = letra.secciones;
  let tramos: TramoLetra[];

  if (partes.length > 1 && (conLetraPropia || !letra.texto.trim())) {
    secciones = [];
    tramos = [];
    for (const [i, parte] of partes.entries()) {
      // Con cruce, las canciones se solapan en el audio: en la imagen cada una
      // llega hasta donde entra la siguiente, para que el video dure lo mismo
      // que la mezcla y no se vaya sumando el solape.
      const fin = Math.min(partes[i + 1]?.inicio ?? total, total);
      const dura = Math.max(0.5, fin - parte.inicio);
      const propia = parte.letra.trim()
        ? (
            await analizarLetra({
              letra: parte.letra,
              lineamientos: letra.lineamientos,
              instrumental: false,
              mostrarLetra: letra.mostrarLetra,
              titulo: parte.titulo,
              duracion: dura,
              idioma: opciones.idioma,
              motor: opciones.motor,
              modelo: opciones.modelo,
            })
          ).secciones
        : seccionesInstrumentales(dura, letra.lineamientos || letra.texto);

      // El nombre de la cancion delante: en el editor se ve de quien es cada tramo.
      const etiquetadas = propia.map((x) => ({ ...x, etiqueta: `${parte.titulo} · ${x.etiqueta}` }));
      const dentro = repartirSecciones(etiquetadas, dura).map((x) => ({ ...x, inicio: x.inicio + parte.inicio }));
      secciones.push(...etiquetadas);
      tramos.push(...dentro);
    }
    letra.secciones = secciones;
  } else {
    tramos = repartirSecciones(secciones, total);
  }

  // Un solo viaje a las APIs de clips por criterio, sin repetir busquedas.
  const generales = letra.keywords.slice(0, 3);
  const medios: OpcionesMedios = opciones.medios ?? {};
  const busquedas = new Map<string, Promise<ClipInfo[]>>();
  const pedir = (k: string) => {
    const clave = k.toLowerCase().trim();
    if (!busquedas.has(clave)) busquedas.set(clave, buscarClips(clave, { ...medios, largos: true }).catch(() => []));
    return busquedas.get(clave)!;
  };
  for (const s of secciones) for (const k of s.keywords) pedir(k);
  for (const k of generales) pedir(k);

  const video: ClipPista[] = [];
  const textos: RotuloPista[] = [];
  const usados = new Set<string>();
  const mostrarLetra = letra.mostrarLetra && !letra.instrumental;

  for (const [i, seccion] of secciones.entries()) {
    const tramo = tramos[i];
    const listas = await Promise.all([...seccion.keywords, ...generales].map(pedir));
    const candidatos = [...new Map(listas.flat().map((c) => [c.id, c])).values()];
    // En el coro los planos cortan mas rapido; en la intro se dejan respirar.
    const maximoPlano = seccion.destacada ? 6 : candidatos.some((c) => (c.duracion ?? 0) >= CLIP_LARGO) ? 12 : 10;
    video.push(...rellenarTramo(candidatos, tramo.duracion, usados, maximoPlano));
    if (mostrarLetra) textos.push(...rotulosDeSeccion(seccion.texto, tramo.inicio, tramo.duracion));
  }

  const datos = {
    escenas: video,
    textos,
    // Un videoclip no lleva voz en off: la pista de voz queda apagada.
    voz: { modo: "ninguna", texto: "", config: null, archivo: null, duracion: null, inicio: 0, huella: null, tramos: [] },
    // La musica es el contenido, no el fondo: suena entera.
    musica: { ...musica, volumen: 1 },
    letra,
  };

  await db.proyecto.update({ where: { id: proyectoId }, data: datos });
  return { video, textos, letra, tramos, duracion: total, duracionCancion, partes };
}

/**
 * Los mejores tramos de la cancion para cortar, con el nombre de la seccion
 * en la que caen. Es lo que alimenta los cortes de 30 segundos para redes.
 */
export async function momentosDeProyecto(proyectoId: string, ventana = 30, cuantos = 3): Promise<{
  duracion: number;
  momentos: Momento[];
}> {
  const p = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const musica = MusicaCapaSchema.parse(p.musica ?? {});
  const ruta = rutaMusicaDeProyecto(proyectoId, musica);

  const duracion = Math.min(await duracionAudio(ruta), topeVideoclip());
  const letra = esLetra(p.letra);
  const tramos = letra?.secciones.length ? repartirSecciones(letra.secciones, duracion) : [];
  const energias = await energiaPorSegundo(ruta);
  return { duracion, momentos: mejoresMomentos(energias, ventana, tramos, cuantos) };
}
