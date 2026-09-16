import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { crearCarpetaProyecto } from "../almacen.js";
import { buscarPreset } from "../render/presets.js";
import { generarDialogo, GuionDialogoSchema, IdiomaCampo, MOTORES } from "../servicios/guion.js";
import { VozSchema } from "../servicios/voz.js";
import { ensamblarProyecto } from "../servicios/ensamblar.js";
import { HablanteSchema, ProyectoSchema, clipVacio } from "../servicios/proyecto.js";
import { CategoriaCampo, SubcategoriaCampo, BancosCampo, MediosCampo } from "./historias.js";
import { esBanco, esMedio, type Banco, type TipoMedio } from "../servicios/clips.js";

/**
 * Diálogos: dos o tres voces hablando de un tema, tipo pódcast corto.
 *
 * Se escribe primero (para poder corregirlo) y después se monta: cada
 * intervención se sintetiza con la voz de quien habla, los rótulos salen con
 * su nombre y su color, y el vídeo se rellena con material del tema.
 */

const idParam = z.object({ id: z.string().uuid() });

/** Colores por defecto de cada voz; se ven bien sobre vídeo oscuro. */
const COLORES = ["#FFE500", "#7FD1FF", "#FF9E7F"];

const HablantePeticion = z.object({
  nombre: z.string().min(1).max(40),
  papel: z.string().max(120).default(""),
  config: VozSchema,
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
});

const PeticionDialogoSchema = z.object({
  tema: z.string().min(3).max(300),
  hablantes: z.array(HablantePeticion).min(2).max(3),
  motor: z.enum(MOTORES).default("groq"),
  modelo: z.string().max(80).nullable().default(null),
  duracion: z.number().int().min(20).max(900).default(90),
  idioma: IdiomaCampo.default("es"),
  region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
  modismos: z.boolean().default(true),
  categoria: CategoriaCampo,
  subcategoria: SubcategoriaCampo,
});

export async function rutasDialogos(app: FastifyInstance) {
  /** Escribe la conversación sin montar nada, para leerla y corregirla. */
  app.post("/api/dialogo", async (req) => {
    const p = PeticionDialogoSchema.parse(req.body);
    return generarDialogo({
      ...p,
      hablantes: p.hablantes.map((h) => ({ nombre: h.nombre, papel: h.papel })),
    });
  });

  /**
   * Crea el proyecto del diálogo: guarda las voces y las intervenciones, y lo
   * ensambla (voz por intervención, rótulos con el nombre de quien habla y
   * clips del tema). Devuelve el proyecto para abrirlo en el editor.
   */
  app.post("/api/dialogos", async (req, reply) => {
    const { guion, hablantes, formato, nombre, bancos, medios, idioma } = z
      .object({
        guion: GuionDialogoSchema,
        /** El mismo con el que se escribió: fija la voz y el tono. */
        idioma: IdiomaCampo.default("es"),
        hablantes: z.array(HablantePeticion).min(2).max(3),
        formato: z.string().max(40).default("tiktok"),
        nombre: z.string().min(1).max(120).optional(),
        bancos: BancosCampo,
        medios: MediosCampo,
      })
      .parse(req.body);

    if (guion.intervenciones.some((i) => i.hablante >= hablantes.length)) {
      return reply.code(400).send({ error: "Hay intervenciones de una voz que no existe" });
    }

    const voces = hablantes.map((h, i) =>
      HablanteSchema.parse({
        nombre: h.nombre,
        papel: guion.hablantes[i]?.papel ?? h.papel,
        config: h.config,
        color: h.color ?? COLORES[i % COLORES.length],
      }),
    );

    const datos = ProyectoSchema.parse({
      nombre: nombre ?? guion.titulo,
      formato: buscarPreset(formato).id,
      // El vídeo se rellena al ensamblar, cuando ya se sabe cuánto dura el audio.
      video: [clipVacio()],
      textos: [],
      voz: {
        modo: "dialogo",
        idioma: idioma === "en" ? "en" : "es",
        // El texto seguido sirve para buscar imagen y para leerlo de un vistazo.
        texto: guion.intervenciones.map((i) => i.texto).join("\n\n"),
        hablantes: voces,
        dialogo: guion.intervenciones,
      },
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
      },
    });
    await crearCarpetaProyecto(proyecto.id);

    try {
      await ensamblarProyecto(proyecto.id, {
        idioma: idioma === "en" ? "en" : "es",
        criterios: guion.keywords,
        medios: {
          bancos: bancos.filter(esBanco) as Banco[],
          medios: medios.filter(esMedio) as TipoMedio[],
        },
      });
    } catch (err) {
      // El proyecto se queda creado con el diálogo dentro: se puede reintentar
      // desde el editor sin volver a escribirlo.
      return reply.code(207).send({
        ...proyecto,
        aviso: `El dialogo se guardo, pero el montaje fallo: ${err instanceof Error ? err.message : "error"}`,
      });
    }

    return reply.code(201).send(await db.proyecto.findUniqueOrThrow({ where: { id: proyecto.id } }));
  });

  /**
   * Cambia las intervenciones o las voces de un diálogo ya creado y lo vuelve
   * a montar. Es lo que permite corregir una réplica sin empezar de cero.
   */
  app.post("/api/proyectos/:id/dialogo", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { hablantes, dialogo, remontar } = z
      .object({
        hablantes: z.array(HablantePeticion).min(2).max(3),
        dialogo: z
          .array(z.object({ hablante: z.number().int().min(0).max(2), texto: z.string().min(1).max(1200) }))
          .min(1)
          .max(120),
        remontar: z.boolean().default(true),
      })
      .parse(req.body);

    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (dialogo.some((i) => i.hablante >= hablantes.length)) {
      return reply.code(400).send({ error: "Hay intervenciones de una voz que no existe" });
    }

    const voces = hablantes.map((h, i) =>
      HablanteSchema.parse({ ...h, color: h.color ?? COLORES[i % COLORES.length] }),
    );
    const voz = {
      ...((p.voz ?? {}) as object),
      modo: "dialogo",
      texto: dialogo.map((i) => i.texto).join("\n\n"),
      hablantes: voces,
      dialogo,
    };
    await db.proyecto.update({ where: { id }, data: { voz } });
    if (!remontar) return { guardado: true };

    await ensamblarProyecto(id);
    return db.proyecto.findUniqueOrThrow({ where: { id } });
  });
}
