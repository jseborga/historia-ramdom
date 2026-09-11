import type { FuenteIdea, Idea, Gancho } from "@prisma/client";
import { db } from "../db.js";

/**
 * Banco de historias y de ganchos.
 *
 * La eleccion es aleatoria pero sesgada por la puntuacion que dejaron las
 * metricas: lo que funciono sale mas veces, sin dejar de probar cosas nuevas.
 */

/** Peso base de una idea sin datos todavia: se explora, no se descarta. */
export const PESO_BASE = 1;
/** Cuanto empuja la puntuacion (0-100) al peso de una idea. */
export const EMPUJE_PUNTUACION = 0.04;
/** Probabilidad de reutilizar un gancho ya probado en vez de escribir uno nuevo. */
export const PROB_REUSO_GANCHO = 0.35;
/** Puntuacion a partir de la cual un gancho se considera bueno. */
export const UMBRAL_GANCHO = 60;

function elegirPonderado<T extends { puntuacion: number | null }>(items: T[]): T | undefined {
  if (!items.length) return undefined;
  const pesos = items.map((i) => PESO_BASE + (i.puntuacion ?? 0) * EMPUJE_PUNTUACION);
  const total = pesos.reduce((a, b) => a + b, 0);
  let tirada = Math.random() * total;
  for (const [i, peso] of pesos.entries()) {
    tirada -= peso;
    if (tirada <= 0) return items[i];
  }
  return items[items.length - 1];
}

/**
 * Saca una idea del banco. Prefiere las pendientes; si se acabaron y
 * `reutilizar` esta activo, vuelve a las mejor puntuadas ya usadas.
 */
export async function elegirIdea(idioma: string, reutilizar = true): Promise<Idea | null> {
  const pendientes = await db.idea.findMany({
    where: { estado: "PENDIENTE", idioma },
    orderBy: { creadaEn: "asc" },
    take: 50,
  });
  const elegida = elegirPonderado(pendientes);
  if (elegida) return elegida;

  if (!reutilizar) return null;
  const usadas = await db.idea.findMany({
    where: { estado: "USADA", idioma, puntuacion: { not: null } },
    orderBy: { puntuacion: "desc" },
    take: 20,
  });
  return elegirPonderado(usadas) ?? null;
}

export async function marcarIdeaUsada(id: string) {
  return db.idea.update({
    where: { id },
    data: { estado: "USADA", usos: { increment: 1 } },
  });
}

export async function guardarIdeas(
  ideas: { titulo: string; tema: string; idioma: string; refExterna?: string; notas?: string }[],
  fuente: FuenteIdea,
) {
  let nuevas = 0;
  for (const idea of ideas) {
    // refExterna es unica: repetir una fuente no duplica el banco.
    const existe = idea.refExterna
      ? await db.idea.findUnique({ where: { refExterna: idea.refExterna } })
      : null;
    if (existe) continue;
    await db.idea.create({ data: { ...idea, fuente } });
    nuevas++;
  }
  return nuevas;
}

/**
 * Devuelve un gancho ya probado que merezca repetirse, o null para que el
 * modelo escriba uno nuevo.
 */
export async function elegirGanchoProbado(idioma: string): Promise<Gancho | null> {
  if (Math.random() > PROB_REUSO_GANCHO) return null;
  const buenos = await db.gancho.findMany({
    where: { idioma, puntuacion: { gte: UMBRAL_GANCHO } },
    orderBy: { puntuacion: "desc" },
    take: 10,
  });
  return elegirPonderado(buenos) ?? null;
}

/** Registra el gancho usado (o incrementa sus usos si ya existia). */
export async function registrarGancho(texto: string, idioma: string): Promise<Gancho> {
  const limpio = texto.trim().slice(0, 300);
  return db.gancho.upsert({
    where: { texto_idioma: { texto: limpio, idioma } },
    create: { texto: limpio, idioma, usos: 1 },
    update: { usos: { increment: 1 } },
  });
}
