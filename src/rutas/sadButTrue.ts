import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { crearCarpetaProyecto } from "../almacen.js";
import { buscarPreset } from "../render/presets.js";
import { IdiomaCampo, MOTORES } from "../servicios/guion.js";
import { elegirClips, esBancoElegible, esMedio, type TipoMedio } from "../servicios/clips.js";
import { ProyectoSchema, PublicacionSchema } from "../servicios/proyecto.js";
import {
  SadButTrueSchema,
  TONOS,
  descripcionSadButTrue,
  generarSadButTrue,
  pistasDeSadButTrue,
  tiempoDeLectura,
  TIEMPOS,
} from "../servicios/sadButTrue.js";
import {
  analizarPegado,
  filasDePegado,
  guardarFrases,
  guardarGuion,
  listarFrases,
  sortearGuion,
  temasDelBanco,
} from "../servicios/bancoFrases.js";
import { db } from "../db.js";
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

/**
 * Los tiempos que se pueden mover sin que deje de ser este formato.
 *
 * `clipSeg` y `cierreSeg` van sin valor por defecto a propósito: si no vienen,
 * cada texto se queda **lo que se tarda en leerlo**. Ponerles un número es
 * decir "este y no el que salga", que es lo que hace falta para cuadrar un
 * vídeo con música.
 */
const TiemposSchema = z.object({
  sorteoSeg: z.number().min(0.8).max(8).default(TIEMPOS.sorteoSeg),
  retencionSeg: z.number().min(0.3).max(4).default(TIEMPOS.retencionSeg),
  clipSeg: z.number().min(2).max(15).optional(),
  cierreSeg: z.number().min(1).max(10).optional(),
});

const idFrase = z.object({ id: z.string().uuid() });

const FraseSchema = z.object({
  tipo: z.enum(["SORTEO", "REMATE"]).default("SORTEO"),
  palabra: z.string().max(40).default(""),
  texto: z.string().min(1).max(300),
  tema: z.string().max(80).default(""),
  idioma: IdiomaCampo.default("es"),
  tono: z.enum(TONOS).default("reflexiva"),
});

export async function rutasSadButTrue(app: FastifyInstance) {
  /** Escribe el guion sin montar nada, para poder corregirlo antes. */
  app.post("/api/sadbuttrue", async (req, reply) => {
    const p = PeticionSchema.parse(req.body);
    return conMotivo(reply, async () => {
      const g = await generarSadButTrue(p);
      // Lo escrito se queda en el banco: la próxima vez puede salir sorteado
      // sin gastar una llamada, y su palabra llena el bombo de las demás.
      await guardarGuion(g, p.tema || g.titulo, p.idioma);
      return g;
    });
  });

  /** Un guion sacado del banco, sin IA y al instante. */
  app.post("/api/sadbuttrue/azar", async (req, reply) => {
    const p = z
      .object({
        tema: z.string().max(80).default(""),
        tono: z.enum(TONOS).or(z.literal("")).default(""),
        idioma: IdiomaCampo.default("es"),
      })
      .parse(req.body ?? {});
    return conMotivo(reply, () => sortearGuion({ tema: p.tema || undefined, tono: p.tono, idioma: p.idioma }));
  });

  /** El banco: lo que hay, y de qué temas. */
  app.get("/api/frases", async (req) => {
    const f = z
      .object({
        tipo: z.enum(["SORTEO", "REMATE"]).optional(),
        tema: z.string().max(80).optional(),
        idioma: IdiomaCampo.optional(),
        buscar: z.string().max(80).optional(),
      })
      .parse(req.query);
    const [frases, temas] = await Promise.all([listarFrases(f), temasDelBanco(f.idioma)]);
    return { frases, temas };
  });

  /** Pegar frases a mano: una por línea, `palabra ; frase`. */
  app.post("/api/frases", async (req, reply) => {
    const frases = z.array(FraseSchema).min(1).max(300).parse(req.body);
    const r = await guardarFrases(frases, "MANUAL");
    return reply.code(201).send(r);
  });

  /**
   * Lo pegado de una vez: `palabra ; frase [; remate]`, o un remate suelto.
   *
   * Con `guardar: false` solo dice qué ha entendido de cada línea, que es lo
   * que se enseña en la vista previa. Guardar a ciegas un texto pegado es la
   * forma más rápida de llenar el banco de basura.
   */
  app.post("/api/frases/pegar", async (req) => {
    const { texto, tema, idioma, tono, guardar } = z
      .object({
        texto: z.string().max(40_000),
        tema: z.string().max(80).default(""),
        idioma: IdiomaCampo.default("es"),
        tono: z.enum(TONOS).default("reflexiva"),
        guardar: z.boolean().default(false),
      })
      .parse(req.body);

    const lineas = analizarPegado(texto);
    const filas = filasDePegado(lineas, { tema, idioma, tono });
    if (!guardar) return { lineas, listas: filas.length };

    const r = await guardarFrases(filas, "MANUAL");
    return { lineas, listas: filas.length, ...r };
  });

  app.delete("/api/frases/:id", async (req) => {
    const { id } = idFrase.parse(req.params);
    await db.frase.delete({ where: { id } });
    return { ok: true };
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
    const leido = {
      clipSeg: tiempos.clipSeg ?? tiempoDeLectura(guion.frase, TIEMPOS.clipSeg),
      cierreSeg: tiempos.cierreSeg ?? tiempoDeLectura(guion.remate, TIEMPOS.cierreSeg),
    };

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
      tiempos: { ...tiempos, ...leido },
      ...(clip ? {} : { aviso: "No se encontró ningún clip: el vídeo del medio quedó en negro." }),
    });
  });
}
