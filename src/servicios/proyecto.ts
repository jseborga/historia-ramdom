import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { creditosLargos, armarDescripcion, BANCOS, MEDIOS } from "./clips.js";
import { VozSchema, VOZ_POR_DEFECTO } from "./voz.js";
import { ESTILO_POR_DEFECTO, fragmentar, type EstiloTexto, type Lectura } from "../render/rotulos.js";
import { PRESETS, PRESET_POR_DEFECTO, EFECTOS, movimientoPorIndice, type Efecto } from "../render/presets.js";

/** Los ids de efecto, para el esquema; la lista viva está en `presets.ts`. */
const EFECTOS_ID = EFECTOS as [Efecto, ...Efecto[]];

/**
 * Efecto con el que entra un clip nuevo en la línea de tiempo. Las fotos
 * SIEMPRE llevan movimiento —y uno distinto cada vez— para que no se note que
 * son fotos; los vídeos se dejan quietos salvo el primero, que abre con zoom.
 */
export const efectoDeClip = (clip: { tipo?: string } | null, indice: number): Efecto =>
  clip?.tipo === "imagen" ? movimientoPorIndice(indice) : indice === 0 ? "zoomLento" : "ninguno";
import { esCalidad } from "../render/calidad.js";
import type { ClipInfo } from "./clips.js";
import type { Guion } from "./guion.js";

/**
 * Un proyecto son TRES PISTAS sobre el mismo eje de tiempo, como en CapCut:
 *
 *   video   clips en secuencia, cada uno con su duracion; no saben nada del texto
 *   textos  rotulos con inicio y duracion propios, se superponen donde quieras
 *   voz     una narracion continua leida con una sola voz, colocada en un instante
 *
 * Mas la musica de fondo. Nada obliga a que un texto coincida con un clip.
 */

export const DURACION_CLIP = 4;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Color en formato #RRGGBB");

export const EstiloSchema = z.object({
  fuente: z.string().min(1).max(60).default(ESTILO_POR_DEFECTO.fuente),
  tamano: z.number().int().min(20).max(200).default(ESTILO_POR_DEFECTO.tamano),
  color: hex.default(ESTILO_POR_DEFECTO.color),
  contorno: hex.default(ESTILO_POR_DEFECTO.contorno),
  posicion: z.enum(["arriba", "centro", "abajo"]).default(ESTILO_POR_DEFECTO.posicion),
  negrita: z.boolean().default(ESTILO_POR_DEFECTO.negrita),
});

export const ClipSchema = z.object({
  // Los ids de la NASA son el nombre de la ficha ("nasa-Mars 2020 Perseverance
  // - Surface Update..."), así que no caben en 60 caracteres.
  id: z.string().max(200),
  fuente: z.enum(BANCOS),
  /** "imagen" = foto: en el render se anima para que parezca vídeo. */
  tipo: z.enum(MEDIOS).default("video"),
  autor: z.string().max(120),
  pagina: z.string().max(400),
  licencia: z.string().max(80),
  url: z.string().url().max(600),
  imagen: z.string().url().max(600).optional(),
  /**
   * Duracion real del archivo en origen. Se guarda con el clip porque es el
   * tope de lo que se puede estirar en la linea de tiempo: sin ella, al
   * recargar el proyecto el editor ya no sabria hasta donde llega el material.
   */
  duracion: z.number().min(0).max(36_000).optional(),
});

/** Un clip de la pista de video. Su inicio es la suma de los anteriores. */
export const ClipPistaSchema = z.object({
  id: z.string().max(60),
  /** null = fondo de color liso. */
  clip: ClipSchema.nullable().default(null),
  color: hex.default("#111318"),
  duracion: z.number().min(0.5).max(350).default(DURACION_CLIP),
  /** Segundo del clip original por el que empieza (recorte de entrada). */
  recorte: z.number().min(0).max(3600).default(0),
  efecto: z.enum(EFECTOS_ID).default("ninguno"),
});

/** Un rotulo de la pista de textos, con su propio sitio en el tiempo. */
export const RotuloPistaSchema = z.object({
  id: z.string().max(60),
  inicio: z.number().min(0).max(3600).default(0),
  duracion: z.number().min(0.2).max(300).default(DURACION_CLIP),
  texto: z.string().max(2000).default(""),
  estilo: EstiloSchema.default({}),
  animacion: z.enum(["ninguna", "fundido", "subir", "zoom", "resaltar"]).default("fundido"),
  lectura: z.enum(["todo", "frases", "bloques"]).default("frases"),
});

/** La narracion: un solo texto, una sola voz, colocada en `inicio`. */
export const VozPistaSchema = z.object({
  modo: z.enum(["ninguna", "servidor", "archivo"]).default("servidor"),
  texto: z.string().max(20_000).default(""),
  config: VozSchema.nullable().default(VOZ_POR_DEFECTO),
  /** Archivo dentro de la carpeta del proyecto: generado o subido. */
  archivo: z.string().max(200).nullable().default(null),
  duracion: z.number().min(0).nullable().default(null),
  inicio: z.number().min(0).max(3600).default(0),
  /** Con que texto y voz se genero `archivo`; si cambia, hay que regenerar. */
  huella: z.string().max(64).nullable().default(null),
  /** Frase a frase, con el tiempo REAL que ocupa cada una en el audio. */
  tramos: z
    .array(z.object({ texto: z.string(), inicio: z.number(), duracion: z.number() }))
    .default([]),
});

/**
 * Una cancion dentro de la pista de musica. Un videoclip puede encadenar
 * varias (Suno entrega temas cortos): cada una sabe donde empieza, cuanto
 * dura, de donde salio y cual es SU letra.
 */
export const ParteMusicaSchema = z.object({
  archivo: z.string().max(200),
  titulo: z.string().max(120).default(""),
  /** Enlace publico (Suno) para los creditos; null si es un archivo propio. */
  enlace: z.string().max(400).nullable().default(null),
  inicio: z.number().min(0).max(36_000).default(0),
  duracion: z.number().min(0).max(36_000).default(0),
  /** Letra de esta cancion; vacia si es instrumental o no se pego. */
  letra: z.string().max(20_000).default(""),
});

export const MusicaCapaSchema = z.object({
  archivo: z.string().max(200).nullable().default(null),
  subida: z.boolean().default(false),
  volumen: z.number().min(0).max(1).default(0.25),
  /** Las canciones que forman `archivo`, en orden. Vacio = una sola pista. */
  partes: z.array(ParteMusicaSchema).max(8).default([]),
});

export const ProyectoSchema = z.object({
  nombre: z.string().min(1).max(120),
  formato: z
    .string()
    .refine((v) => PRESETS.some((p) => p.id === v), "Formato desconocido")
    .default(PRESET_POR_DEFECTO.id),
  /** Perfil de compresión del render: alta, normal o ligera. */
  calidad: z
    .string()
    .refine((v) => esCalidad(v), "Calidad desconocida")
    .default("normal"),
  video: z.array(ClipPistaSchema).min(1).max(400),
  textos: z.array(RotuloPistaSchema).max(600).default([]),
  voz: VozPistaSchema.default({}),
  musica: MusicaCapaSchema.default({}),
});

export type ClipPista = z.infer<typeof ClipPistaSchema>;
export type RotuloPista = z.infer<typeof RotuloPistaSchema>;
export type VozPista = z.infer<typeof VozPistaSchema>;
export type MusicaCapa = z.infer<typeof MusicaCapaSchema>;
export type ParteMusica = z.infer<typeof ParteMusicaSchema>;
export type ProyectoDatos = z.infer<typeof ProyectoSchema>;

// ---- Tiempo ----

export const duracionVideo = (video: ClipPista[]) => video.reduce((s, c) => s + c.duracion, 0);
export const inicioDeClip = (video: ClipPista[], i: number) =>
  video.slice(0, i).reduce((s, c) => s + c.duracion, 0);
export const finVoz = (voz: VozPista) =>
  voz.modo === "ninguna" || !voz.duracion ? 0 : voz.inicio + voz.duracion;
export const finTextos = (textos: RotuloPista[]) =>
  textos.reduce((m, t) => Math.max(m, t.inicio + t.duracion), 0);

/** El proyecto dura lo que la pista mas larga; el video se congela si hace falta. */
export const duracionProyecto = (p: Pick<ProyectoDatos, "video" | "textos" | "voz">) =>
  Math.max(duracionVideo(p.video), finVoz(p.voz), finTextos(p.textos));

/** Identifica el par texto+voz con el que se genero la narracion. */
export const huellaVoz = (voz: Pick<VozPista, "texto" | "config">) =>
  createHash("sha1").update(JSON.stringify([voz.texto.trim(), voz.config])).digest("hex");

// ---- Construccion ----

export function clipVacio(duracion = DURACION_CLIP): ClipPista {
  return ClipPistaSchema.parse({ id: randomUUID(), duracion });
}

export function rotuloNuevo(inicio: number, texto = "", duracion = DURACION_CLIP): RotuloPista {
  return RotuloPistaSchema.parse({ id: randomUUID(), inicio, duracion, texto });
}

/** El gancho se rotula mas grande y en el centro. */
const estiloGancho: EstiloTexto = {
  ...ESTILO_POR_DEFECTO,
  tamano: 84,
  color: "#FFE500",
  posicion: "centro",
  negrita: true,
};

/**
 * Reparte unos textos a lo largo de un tramo, en proporcion a sus palabras.
 * Sirve para colocar los rotulos sobre la narracion ya generada.
 */
export function repartirTextos(
  textos: string[],
  inicio: number,
  duracionTotal: number,
  base: Partial<RotuloPista> = {},
): RotuloPista[] {
  const pesos = textos.map((t) => Math.max(t.trim().split(/\s+/).filter(Boolean).length, 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  let t = inicio;
  return textos.map((texto, i) => {
    const duracion = Math.max((duracionTotal * pesos[i]) / total, 0.2);
    const r = RotuloPistaSchema.parse({ ...base, id: randomUUID(), inicio: t, duracion, texto });
    t += duracion;
    return r;
  });
}

/**
 * Rotulos a partir de la narracion. Si la voz ya esta generada, cada frase
 * cae EXACTAMENTE donde suena (tramos medidos del audio); si no, se reparte
 * en proporcion a las palabras.
 */
export function textosDesdeNarracion(
  voz: VozPista,
  duracionSiNoHay: number,
  lectura: Lectura = "frases",
  base: Partial<RotuloPista> = {},
): RotuloPista[] {
  if (voz.modo !== "ninguna" && voz.tramos.length) {
    return voz.tramos.map((t) =>
      RotuloPistaSchema.parse({
        ...base,
        id: randomUUID(),
        inicio: voz.inicio + t.inicio,
        duracion: Math.max(t.duracion, 0.2),
        texto: t.texto,
        lectura: lectura === "bloques" ? "bloques" : "todo",
      }),
    );
  }
  const frases = fragmentar(voz.texto, lectura === "todo" ? "frases" : lectura);
  const largo = voz.duracion && voz.modo !== "ninguna" ? voz.duracion : duracionSiNoHay;
  return repartirTextos(frases, voz.inicio, largo, { ...base, lectura: "todo" });
}

/**
 * Pistas iniciales desde un guion: los clips elegidos en secuencia, la
 * narracion completa (gancho + escenas) como un solo texto, y un rotulo por
 * escena colocado sobre su clip. Desde ahi cada pista va por su cuenta.
 */
export function pistasDesdeGuion(
  guion: Guion,
  clipsPorEscena: (ClipInfo | null)[] = [],
  duraciones: number[] = [],
): Pick<ProyectoDatos, "video" | "textos"> & { narracion: string } {
  const textos = [guion.gancho, ...guion.escenas.map((e) => e.texto)];

  const video: ClipPista[] = textos.map((_, i) =>
    ClipPistaSchema.parse({
      id: randomUUID(),
      clip: clipsPorEscena[i] ?? null,
      duracion: duraciones[i] ?? DURACION_CLIP,
      efecto: i === 0 ? "zoomLento" : "ninguno",
    }),
  );

  const rotulos: RotuloPista[] = textos.map((texto, i) =>
    RotuloPistaSchema.parse({
      id: randomUUID(),
      inicio: inicioDeClip(video, i),
      duracion: video[i].duracion,
      texto,
      estilo: i === 0 ? estiloGancho : ESTILO_POR_DEFECTO,
      animacion: i === 0 ? "zoom" : "fundido",
    }),
  );

  return { video, textos: rotulos, narracion: textos.join("\n\n") };
}

/**
 * Proyectos guardados con el modelo anterior (una "escena" = clip + texto):
 * se parten en pista de video y pista de textos sin perder nada.
 */
export function desdeEscenasAntiguas(escenas: unknown[]): Pick<ProyectoDatos, "video" | "textos"> {
  const video: ClipPista[] = [];
  const textos: RotuloPista[] = [];
  let t = 0;
  for (const e of escenas as Record<string, unknown>[]) {
    const c = ClipPistaSchema.safeParse({
      id: e.id ?? randomUUID(),
      clip: e.clip ?? null,
      color: e.color,
      duracion: e.duracion,
      efecto: e.efecto,
    });
    if (!c.success) continue;
    video.push(c.data);
    if (typeof e.texto === "string" && e.texto.trim()) {
      textos.push(
        RotuloPistaSchema.parse({
          id: randomUUID(),
          inicio: t,
          duracion: c.data.duracion,
          texto: e.texto,
          estilo: e.estilo,
          animacion: e.animacion,
          lectura: e.lectura,
        }),
      );
    }
    t += c.data.duracion;
  }
  return { video, textos };
}

/**
 * Recorta las tres pistas a una ventana de tiempo: [inicio, inicio+duracion).
 *
 * Es lo que permite sacar del MISMO montaje la version completa y un corte de
 * 30 segundos sin volver a montar nada. Los clips se parten por donde toca
 * (moviendo su recorte de entrada), los rotulos se desplazan y los que caen
 * fuera se van, y la voz y la musica se piden desde el segundo correcto.
 */
export function recortarPistas(
  datos: Pick<ProyectoDatos, "video" | "textos" | "voz">,
  inicio: number,
  duracion: number,
): Pick<ProyectoDatos, "video" | "textos" | "voz"> & { vozDesde: number; musicaDesde: number } {
  const desde = Math.max(0, inicio);
  const hasta = desde + Math.max(0.5, duracion);

  const video: ClipPista[] = [];
  let t = 0;
  for (const c of datos.video) {
    const fin = t + c.duracion;
    if (fin > desde && t < hasta) {
      // Lo que se corta por delante se descuenta del propio clip de origen.
      const recortado = Math.max(0, desde - t);
      const largo = Math.min(fin, hasta) - Math.max(t, desde);
      if (largo > 0.05) {
        video.push(
          ClipPistaSchema.parse({
            ...c,
            id: randomUUID(),
            duracion: largo,
            recorte: c.recorte + recortado,
          }),
        );
      }
    }
    t = fin;
  }
  if (!video.length) video.push(clipVacio(Math.max(0.5, hasta - desde)));

  const textos: RotuloPista[] = [];
  for (const r of datos.textos) {
    const fin = r.inicio + r.duracion;
    if (fin <= desde || r.inicio >= hasta) continue;
    const nuevoInicio = Math.max(r.inicio, desde) - desde;
    const largo = Math.min(fin, hasta) - Math.max(r.inicio, desde);
    if (largo > 0.15) {
      textos.push(RotuloPistaSchema.parse({ ...r, id: randomUUID(), inicio: nuevoInicio, duracion: largo }));
    }
  }

  // La voz suena entre [voz.inicio, voz.inicio + voz.duracion): si la ventana
  // la pilla a medias, el archivo se abre mas adelante en vez de cortarse mal.
  let voz = datos.voz;
  let vozDesde = 0;
  if (voz.modo !== "ninguna" && voz.duracion) {
    const finVozAbs = voz.inicio + voz.duracion;
    if (finVozAbs <= desde || voz.inicio >= hasta) {
      voz = { ...voz, modo: "ninguna" };
    } else {
      vozDesde = Math.max(0, desde - voz.inicio);
      voz = {
        ...voz,
        inicio: Math.max(0, voz.inicio - desde),
        duracion: Math.min(finVozAbs, hasta) - Math.max(voz.inicio, desde),
        tramos: voz.tramos
          .filter((tr) => voz.inicio + tr.inicio + tr.duracion > desde && voz.inicio + tr.inicio < hasta)
          .map((tr) => ({ ...tr, inicio: Math.max(0, voz.inicio + tr.inicio - Math.max(desde, voz.inicio)) })),
      };
    }
  }

  return { video, textos, voz, vozDesde, musicaDesde: desde };
}

/** Distingue el modelo nuevo (clips sin texto) del antiguo (escenas con texto). */
export const esModeloAntiguo = (escenas: unknown[]) =>
  escenas.some((e) => e && typeof e === "object" && "texto" in (e as object));

export const VOZ_IA_POR_DEFECTO = VOZ_POR_DEFECTO;

/** Créditos de los clips de la pista de vídeo, sin repetir. */
export function creditosDeProyecto(video: ClipPista[], musica?: string | null): string {
  const clips = video.filter((c) => c.clip).map((c) => c.clip!);
  return [creditosLargos(clips), musica ?? ""].filter(Boolean).join("\n");
}

/**
 * Descripción corta lista para pegar al publicar: gancho viral, gancho del
 * vídeo, hashtags y créditos en una línea.
 */
export function descripcionDeProyecto(
  nombre: string,
  video: ClipPista[],
  hashtags: string[] = [],
  gancho?: string | null,
  musica?: string | null,
  ganchos: string[] = [],
): string {
  const clips = video.filter((c) => c.clip).map((c) => c.clip!);
  return armarDescripcion(gancho?.trim() || nombre, hashtags, clips, musica, ganchos);
}
