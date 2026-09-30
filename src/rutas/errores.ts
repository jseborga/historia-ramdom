import type { FastifyReply } from "fastify";
import { ZodError } from "zod";
import { VariasOpciones } from "../servicios/enlaces.js";

/**
 * Por qué falló, dicho de forma que se pueda arreglar.
 *
 * El manejador general convierte cualquier error no previsto en un 500 con
 * "Error interno", que para un fallo del servidor está bien: no hay que
 * enseñar las tripas. Pero lo que falla al escribir con IA casi nunca es el
 * servidor —falta la clave, el motor devolvió JSON roto, se acabó la cuota—, y
 * eso el usuario sí puede arreglarlo… si se lo cuentan. Con "Error interno"
 * delante, lo único que se ve es que "no se genera".
 *
 * Y un ZodError aquí tampoco son "datos inválidos" del usuario: es el modelo
 * el que devolvió algo que no encaja. Se dice así, con el campo concreto.
 */
export async function conMotivo<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      const detalle = err.issues
        .slice(0, 3)
        .map((i) => `${i.path.join(".") || "respuesta"}: ${i.message}`)
        .join("; ");
      return reply.code(422).send({
        error: `El motor devolvió algo que no encaja (${detalle}). Vuelve a intentarlo o cambia de motor.`,
      });
    }
    return reply.code(422).send({
      error: (err instanceof Error ? err.message : "No se pudo generar").slice(0, 400),
    });
  }
}

/**
 * Como `conMotivo`, para lo que se trae de un enlace: si el enlace tiene
 * varias cosas que traer (una conversación de Gemini con varios vídeos), se
 * responde 409 con las opciones para que se elija una.
 */
export async function conEnlace<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | FastifyReply> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof VariasOpciones) return reply.code(409).send({ error: err.message, opciones: err.opciones });
    return reply.code(422).send({ error: (err instanceof Error ? err.message : "No se pudo traer").slice(0, 400) });
  }
}
