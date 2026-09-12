import { randomUUID } from "node:crypto";
import { z } from "zod";
import { VozSchema, VOZ_POR_DEFECTO } from "./voz.js";
import { ESTILO_POR_DEFECTO, type EstiloTexto } from "../render/rotulos.js";
import { PRESETS, PRESET_POR_DEFECTO } from "../render/presets.js";
import type { ClipInfo } from "./clips.js";
import type { Guion } from "./guion.js";

/** Duracion por defecto de una escena cuando no la marca ningun audio. */
export const DURACION_ESCENA = 4;

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
  id: z.string().max(60),
  fuente: z.enum(["pexels", "pixabay"]),
  autor: z.string().max(120),
  pagina: z.string().max(400),
  licencia: z.string().max(80),
  url: z.string().url().max(600),
  imagen: z.string().url().max(600).optional(),
});

export const EscenaSchema = z.object({
  id: z.string().max(60),
  /** null = fondo de color liso, util mientras se decide el clip. */
  clip: ClipSchema.nullable().default(null),
  color: hex.default("#111318"),
  /** Hasta tres minutos: una escena puede ser un parrafo entero leido despacio. */
  duracion: z.number().min(0.5).max(180).default(DURACION_ESCENA),
  texto: z.string().max(2000).default(""),
  estilo: EstiloSchema.default({}),
  animacion: z.enum(["ninguna", "fundido", "subir", "zoom", "resaltar"]).default("fundido"),
  /** Como se va mostrando el texto: entero, frase a frase o por bloques. */
  lectura: z.enum(["todo", "frases", "bloques"]).default("frases"),
  /** Efecto de imagen sobre el clip o el fondo. */
  efecto: z.enum(["ninguno", "zoomLento", "fundido", "blancoYNegro", "vineta"]).default("ninguno"),
  esGancho: z.boolean().default(false),
});

export const VozCapaSchema = z.object({
  modo: z.enum(["ninguna", "ia", "archivo"]).default("ninguna"),
  /** Nombre del archivo subido dentro de la carpeta del proyecto. */
  archivo: z.string().max(200).nullable().default(null),
  config: VozSchema.nullable().default(null),
});

export const MusicaCapaSchema = z.object({
  /** Pista de DATA_DIR/musica o archivo subido al proyecto. */
  archivo: z.string().max(200).nullable().default(null),
  subida: z.boolean().default(false),
  volumen: z.number().min(0).max(1).default(0.25),
});

export const ProyectoSchema = z.object({
  nombre: z.string().min(1).max(120),
  formato: z
    .string()
    .refine((v) => PRESETS.some((p) => p.id === v), "Formato desconocido")
    .default(PRESET_POR_DEFECTO.id),
  escenas: z.array(EscenaSchema).min(1).max(60),
  voz: VozCapaSchema.default({}),
  musica: MusicaCapaSchema.default({}),
});

export type Escena = z.infer<typeof EscenaSchema>;
export type VozCapa = z.infer<typeof VozCapaSchema>;
export type MusicaCapa = z.infer<typeof MusicaCapaSchema>;
export type ProyectoDatos = z.infer<typeof ProyectoSchema>;

export const duracionTotal = (escenas: Escena[]) =>
  escenas.reduce((suma, e) => suma + e.duracion, 0);

/** El gancho se rotula mas grande y arriba, como en la version automatica. */
const estiloGancho: EstiloTexto = {
  ...ESTILO_POR_DEFECTO,
  tamano: 84,
  color: "#FFE500",
  posicion: "centro",
  negrita: true,
};

/**
 * Monta la linea de tiempo inicial: el orden secuencial del guion con los
 * clips que ya se eligieron. El editor abre con algo montado y desde ahi se
 * cambia pieza a pieza.
 */
export function lineaDeTiempoDesdeGuion(
  guion: Guion,
  clipsPorEscena: (ClipInfo | null)[] = [],
  duraciones: number[] = [],
): Escena[] {
  const textos = [guion.gancho, ...guion.escenas.map((e) => e.texto)];

  return textos.map((texto, i) => ({
    id: randomUUID(),
    clip: clipsPorEscena[i] ?? null,
    color: "#111318",
    duracion: duraciones[i] ?? DURACION_ESCENA,
    texto,
    estilo: i === 0 ? estiloGancho : ESTILO_POR_DEFECTO,
    animacion: i === 0 ? "zoom" : "fundido",
    lectura: "frases" as const,
    efecto: i === 0 ? ("zoomLento" as const) : ("ninguno" as const),
    esGancho: i === 0,
  }));
}

export function escenaVacia(): Escena {
  return EscenaSchema.parse({ id: randomUUID(), texto: "" });
}

export const VOZ_IA_POR_DEFECTO = VOZ_POR_DEFECTO;
