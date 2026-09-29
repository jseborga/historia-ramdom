import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { crearCarpetaProyecto } from "../almacen.js";
import { buscarPreset } from "../render/presets.js";
import { IdiomaCampo, MOTORES } from "../servicios/guion.js";
import { elegirClips, esBancoElegible, esMedio, type TipoMedio } from "../servicios/clips.js";
import { ProyectoSchema, PublicacionSchema } from "../servicios/proyecto.js";
import {
  SadButTrueSchema,
  TIEMPOS,
  TONOS,
  descripcionSadButTrue,
  generarSadButTrue,
  pistasDeSadButTrue,
} from "../servicios/sadButTrue.js";
import { BancosCampo, MediosCampo } from "./historias.js";
import { conMotivo } from "./errores.js";

/**
 * Sad but true: sorteo de palabras sobre negro, la frase sobre un vídeo
 * cualquiera y el remate desvaneciéndose. Diez segundos.
 *
 * A diferencia del resto de áreas, esta **no pasa por el ensamblado**: el
 * ensamblado reparte los planos según lo que dure la voz, y aquí no hay voz
 * ninguna —los tiempos son el formato—. Así que la línea de tiempo se monta
 * entera aquí y el proyecto nace listo para renderizar.
 */

const PeticionSchema = z.object({
  tema: z.string().max(300).default(""),
  tono: z.enum(TONOS).or(z.literal("")).default(""),
  motor: z.enum(MOTORES).default("groq"),
  modelo: z.string().max(80).nullable().default(null),
  idioma: IdiomaCampo.default("es"),
  region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
  modismos: z.boolean().default(true),
});

/** Los tiempos que se pueden mover sin que deje de ser este formato. */
const TiemposSchema = z.object({
  sorteoSeg: z.number().min(0.8).max(8).default(TIEMPOS.sorteoSeg),
  retencionSeg: z.number().min(0.3).max(4).default(TIEMPOS.retencionSeg),
  clipSeg: z.number().min(2).max(15).default(TIEMPOS.clipSeg),
  cierreSeg: z.number().min(1).max(10).default(TIEMPOS.cierreSeg),
});

export async function rutasSadButTrue(app: FastifyInstance) {
  /** Escribe el guion sin montar nada, para poder corregirlo antes. */
  app.post("/api/sadbuttrue", async (req, reply) => {
    const p = PeticionSchema.parse(req.body);
    return conMotivo(reply, () => generarSadButTrue(p));
  });

  /**
   * Monta el vídeo con el guion (el generado o el corregido a mano): busca un
   * clip para el medio y deja las dos pistas con sus tiempos.
   */
  app.post("/api/sadbuttrue/video", async (req, reply) => {
    const { guion, formato, nombre, bancos, medios, revelarFrase, idioma, tiempos } = z
      .object({
        guion: SadButTrueSchema,
        formato: z.string().max(40).default("tiktok"),
        nombre: z.string().min(1).max(120).optional(),
        bancos: BancosCampo,
        medios: MediosCampo,
        /** La frase se escribe palabra a palabra en vez de aparecer entera. */
        revelarFrase: z.boolean().default(false),
        /** El mismo con el que se escribió: solo marca el idioma del proyecto. */
        idioma: IdiomaCampo.default("es"),
        tiempos: TiemposSchema.default({}),
      })
      .parse(req.body);

    const [clip] = await elegirClips([{ keywords: guion.keywords }], new Set(), {}, {
      bancos: bancos.filter(esBancoElegible),
      medios: medios.filter(esMedio) as TipoMedio[],
    });

    const { video, textos } = pistasDeSadButTrue(guion, clip, { ...tiempos, revelarFrase });

    const datos = ProyectoSchema.parse({
      nombre: nombre ?? guion.titulo,
      formato: buscarPreset(formato).id,
      video,
      textos,
      // Sin voz a propósito: este formato se lee, no se escucha. La música se
      // le pone en el editor a quien la quiera.
      voz: { modo: "ninguna", idioma },
      musica: {},
    });

    const proyecto = await db.proyecto.create({
      data: {
        nombre: datos.nombre,
        formato: datos.formato,
        escenas: datos.video,
        textos: datos.textos,
        voz: datos.voz,
        musica: datos.musica,
        publicacion: PublicacionSchema.parse({
          gancho: guion.frase.slice(0, 200),
          ganchos: [guion.remate.slice(0, 150)],
          hashtags: guion.hashtags,
        }),
      },
    });
    await crearCarpetaProyecto(proyecto.id);

    return reply.code(201).send({
      ...proyecto,
      descripcion: descripcionSadButTrue(guion),
      ...(clip ? {} : { aviso: "No se encontró ningún clip: el vídeo del medio quedó en negro." }),
    });
  });
}
