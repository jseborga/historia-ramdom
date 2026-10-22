import type { FastifyInstance } from "fastify";
import { cola } from "../cola/cola.js";

/**
 * Lo que necesita saber quien decide si el servidor puede dormirse: si hay
 * trabajo en marcha y cuándo toca el siguiente programado.
 *
 * Lo usa el Worker de Cloudflare (cloudflare/src/index.ts): mientras haya un
 * render o algo en cola mantiene el contenedor despierto, y antes de dejarlo
 * dormir se apunta la hora del siguiente trabajo —una serie, una subida
 * programada, las métricas— para despertarlo un poco antes. En Easypanel no
 * hace falta, pero tampoco molesta: va detrás del login como el resto.
 */
export async function rutasInterno(app: FastifyInstance) {
  app.get("/api/interno/actividad", async () => {
    const cuentas = await cola.getJobCounts("active", "waiting", "prioritized", "delayed");
    // Los diferidos vienen ordenados por cuándo vencen; con unos pocos basta.
    const diferidos = await cola.getDelayed(0, 19);
    const vencen = diferidos
      .map((j) => j.timestamp + (j.delay ?? j.opts.delay ?? 0))
      .filter((t) => Number.isFinite(t) && t > 0);
    const proximo = vencen.length ? new Date(Math.min(...vencen)).toISOString() : null;
    const pendientes = (cuentas.active ?? 0) + (cuentas.waiting ?? 0) + (cuentas.prioritized ?? 0);
    return { ocupado: pendientes > 0, cuentas, proximo };
  });
}
