import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MOTORES } from "../servicios/guion.js";
import {
  CambioCita,
  TITULO_PENSADORES,
  borrarCita,
  buscarConIA,
  buscarEnBanco,
  crearCita,
  editarCita,
  guionDeCita,
  listarCitas,
} from "../servicios/pensadores.js";
import { conMotivo } from "./errores.js";

/**
 * «Grandes pensadores»: el banco de citas con su fuente y la búsqueda por la
 * semilla, sin IA (en el banco) o con IA (que guarda lo que encuentra).
 */

const idParam = z.object({ id: z.string().uuid() });
const CierreCampo = z.enum(["aplicacion", "otra_cita"]).default("aplicacion");

export async function rutasPensadores(app: FastifyInstance) {
  app.get("/api/pensadores/citas", async (req) => {
    const f = z
      .object({
        autor: z.string().max(60).optional(),
        q: z.string().max(200).optional(),
        verificada: z.enum(["si", "no"]).optional(),
      })
      .parse(req.query);
    return listarCitas({ autor: f.autor, q: f.q, verificada: f.verificada ? f.verificada === "si" : undefined });
  });

  app.post("/api/pensadores/citas", async (req, reply) => {
    const c = CambioCita.required({ autor: true, texto: true }).parse(req.body);
    return conMotivo(reply, async () => reply.code(201).send(await crearCita(c)));
  });

  app.put("/api/pensadores/citas/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const c = CambioCita.parse(req.body);
    return conMotivo(reply, () => editarCita(id, c));
  });

  app.delete("/api/pensadores/citas/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await borrarCita(id);
    return { ok: true };
  });

  /**
   * De la semilla al guion: busca pensadores (en el banco o con IA), elige
   * uno y devuelve su guion, más los demás encontrados para cambiar de autor.
   */
  app.post("/api/pensadores/buscar", async (req, reply) => {
    const o = z
      .object({
        semilla: z.string().max(200).default(""),
        modo: z.enum(["banco", "ia"]).default("banco"),
        soloComprobadas: z.boolean().default(true),
        motor: z.enum(MOTORES).default("gemini"),
        modelo: z.string().max(80).nullable().default(null),
        cierre: CierreCampo,
        titulo: z.string().min(1).max(80).default(TITULO_PENSADORES),
      })
      .parse(req.body ?? {});
    return conMotivo(reply, async () => {
      if (o.modo === "ia") {
        if (o.semilla.trim().length < 3) throw new Error("Escribe la semilla: un tema o una frase.");
        const r = await buscarConIA({ semilla: o.semilla, motor: o.motor, modelo: o.modelo });
        const cercanos = r.guardadas.map((g) => g.cita.autor);
        const guion = await guionDeCita(r.ganadora.cita.id, {
          semilla: o.semilla,
          cierre: o.cierre,
          titulo: o.titulo,
          cercanos,
          remate: o.cierre === "aplicacion" ? r.ganadora.remate : undefined,
        });
        return {
          guion,
          encontradas: r.guardadas.map((g) => ({ ...g.cita, remateSemilla: g.remate })),
          motorUsado: r.motorUsado,
          avisoMotor: r.aviso,
        };
      }
      const halladas = await buscarEnBanco(o.semilla, { soloComprobadas: o.soloComprobadas });
      if (!halladas.length) {
        throw new Error(
          o.semilla
            ? `El banco no tiene nada sobre «${o.semilla}». Busca con IA: lo que encuentre se queda guardado.`
            : "El banco está vacío.",
        );
      }
      const guion = await guionDeCita(halladas[0].id, {
        semilla: o.semilla,
        cierre: o.cierre,
        titulo: o.titulo,
        cercanos: halladas.map((c) => c.autor),
      });
      return { guion, encontradas: halladas.slice(0, 8) };
    });
  });

  /** El guion de una cita concreta: para cambiar de autor o usar una del banco. */
  app.post("/api/pensadores/guion", async (req, reply) => {
    const o = z
      .object({
        citaId: z.string().uuid(),
        semilla: z.string().max(200).default(""),
        cierre: CierreCampo,
        titulo: z.string().min(1).max(80).default(TITULO_PENSADORES),
        cercanos: z.array(z.string().max(60)).max(10).default([]),
        remate: z.string().max(300).optional(),
      })
      .parse(req.body);
    return conMotivo(reply, () => guionDeCita(o.citaId, o));
  });
}
