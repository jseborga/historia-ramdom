import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LIBROS } from "../servicios/biblia.js";
import { MOTORES } from "../servicios/guion.js";
import {
  CambioReferencia,
  RANGOS,
  TITULO_SERIE,
  borrarReferencia,
  buscarCita,
  completarConIA,
  crearReferencia,
  editarReferencia,
  guionDeReferencia,
  listarReferencias,
  proponerConIA,
} from "../servicios/referencias.js";
import { conMotivo } from "./errores.js";

/**
 * «Aprendiendo con la Biblia»: las referencias guardadas (con su cita
 * comprobada contra el texto) y la serie que las recorre en orden.
 */

const idParam = z.object({ id: z.string().uuid() });
const RangoCampo = z.enum(RANGOS).default("todo");
const MotorCampo = z.enum(MOTORES).default("gemini");

export async function rutasBiblia(app: FastifyInstance) {
  /** Los 66 libros, para los selectores. */
  app.get("/api/biblia/libros", async () =>
    LIBROS.map((l) => ({ numero: l.numero, nombre: l.nombre, testamento: l.testamento })),
  );

  /** Una cita suelta, con su texto: para ver qué dice mientras se escribe. */
  app.get("/api/biblia/cita", async (req, reply) => {
    const { q } = z.object({ q: z.string().min(2).max(80) }).parse(req.query);
    return buscarCita(q) ?? reply.code(404).send({ error: `«${q}» no existe en la Reina-Valera 1909` });
  });

  app.get("/api/biblia/referencias", async (req) => {
    const f = z
      .object({
        rango: RangoCampo,
        libro: z.coerce.number().int().min(1).max(66).optional(),
        estado: z.enum(["pendiente", "revisar", "lista", ""]).default(""),
        q: z.string().max(80).default(""),
      })
      .parse(req.query);
    return listarReferencias(f);
  });

  app.post("/api/biblia/referencias", async (req, reply) => {
    const c = CambioReferencia.required({ cita: true }).parse(req.body);
    return conMotivo(reply, async () => reply.code(201).send(await crearReferencia(c)));
  });

  app.put("/api/biblia/referencias/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = CambioReferencia.parse(req.body);
    return conMotivo(reply, () => editarReferencia(id, c));
  });

  app.delete("/api/biblia/referencias/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await borrarReferencia(id);
    return { ok: true };
  });

  /** Completa con IA las que faltan (o las que se pasen), leyendo el versículo. */
  app.post("/api/biblia/referencias/completar", async (req, reply) => {
    const o = z
      .object({
        ids: z.array(z.string().uuid()).max(10).optional(),
        cuantas: z.number().int().min(1).max(10).default(6),
        rango: RangoCampo,
        motor: MotorCampo,
        modelo: z.string().max(80).nullable().default(null),
        tono: z.enum(["aliento", "historico", ""]).default(""),
        rehacer: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    return conMotivo(reply, () => completarConIA(o));
  });

  /** Busca más referencias en un libro con IA; solo entran las que se comprueban. */
  app.post("/api/biblia/proponer", async (req, reply) => {
    const o = z
      .object({
        libro: z.number().int().min(1).max(66),
        cuantas: z.number().int().min(1).max(15).default(8),
        motor: MotorCampo,
        modelo: z.string().max(80).nullable().default(null),
      })
      .parse(req.body);
    return conMotivo(reply, () => proponerConIA(o));
  });

  /**
   * El guion de un vídeo de la serie: una referencia concreta, la siguiente
   * en orden o una al azar de las listas.
   */
  app.post("/api/biblia/guion", async (req, reply) => {
    const o = z
      .object({
        referenciaId: z.string().uuid().optional(),
        modo: z.enum(["siguiente", "azar"]).default("siguiente"),
        rango: RangoCampo,
        titulo: z.string().min(1).max(80).default(TITULO_SERIE),
      })
      .parse(req.body ?? {});
    return conMotivo(reply, async () => {
      let id = o.referenciaId;
      if (!id) {
        const { referencias, siguiente } = await listarReferencias({ rango: o.rango, estado: "lista" });
        const elegida = o.modo === "azar" ? referencias[Math.floor(Math.random() * referencias.length)] : siguiente;
        if (!elegida) throw new Error("No hay referencias listas: complétalas en «Referencias» (con IA o a mano).");
        id = elegida.id;
      }
      return guionDeReferencia(id, o.titulo);
    });
  });
}
