import { Worker } from "bullmq";
import { conexion, cola, opcionesTrabajo } from "./conexion.js";
import { env } from "../env.js";
import {
  crearHistoria,
  crearHistoriaSuelta,
  publicarHistoria,
  limpiarArchivos,
  sincronizarMetricas,
  buscarIdeasEnReddit,
  renderizarProyectoTrabajo,
  montarVideoclipTrabajo,
  unirCancionesTrabajo,
  renderizarVarianteTrabajo,
  continuarHistoria,
  type OpcionesHistoria,
} from "./trabajos.js";
import type { OpcionesVideoclip } from "../servicios/videoclip.js";
import type { FuenteCancion } from "../servicios/mezcla.js";

export { cola, opcionesTrabajo };

export type SerieProgramable = {
  id: string;
  cron: string;
  zonaHoraria: string;
  activa: boolean;
};

/** Llamala cada vez que crees, edites, pauses o borres una serie. */
export async function programarSerie(serie: SerieProgramable) {
  const idProgramador = `serie-${serie.id}`;
  if (!serie.activa) {
    await cola.removeJobScheduler(idProgramador);
    return;
  }
  await cola.upsertJobScheduler(
    idProgramador,
    { pattern: serie.cron, tz: serie.zonaHoraria },
    { name: "crear-historia", data: { serieId: serie.id }, opts: opcionesTrabajo },
  );
}

export async function quitarSerie(serieId: string) {
  await cola.removeJobScheduler(`serie-${serieId}`);
}

/** Encola una historia fuera de horario (boton "generar ahora"). */
export async function generarAhora(serieId: string) {
  return cola.add("crear-historia", { serieId }, opcionesTrabajo);
}

/** Encola una historia suelta creada desde el editor. */
export async function encolarHistoriaSuelta(opciones: OpcionesHistoria) {
  return cola.add("crear-suelta", { opciones }, opcionesTrabajo);
}

let worker: Worker | undefined;

/** Encola la parte siguiente de una historia. */
export async function encolarContinuacion(historiaId: string) {
  return cola.add("continuar", { historiaId }, opcionesTrabajo);
}

/** Encola el render de un proyecto del editor. */
export async function encolarProyecto(proyectoId: string) {
  return cola.add("render-proyecto", { proyectoId }, { ...opcionesTrabajo, attempts: 1 });
}

/** Encola el montaje de un videoclip (analisis de la letra y busqueda de clips). */
export async function encolarVideoclip(proyectoId: string, opciones: OpcionesVideoclip = {}) {
  return cola.add("montar-videoclip", { proyectoId, opciones }, { ...opcionesTrabajo, attempts: 1 });
}

/** Encola la union de varias canciones en una sola pista (y su montaje). */
export async function encolarCanciones(
  proyectoId: string,
  fuentes: FuenteCancion[],
  cruce?: number,
  montar = true,
) {
  return cola.add("unir-canciones", { proyectoId, fuentes, cruce, montar }, { ...opcionesTrabajo, attempts: 1 });
}

/** Encola el render de un corte del montaje. */
export async function encolarVariante(varianteId: string) {
  return cola.add("render-variante", { varianteId }, { ...opcionesTrabajo, attempts: 1 });
}

/** Encola una sincronizacion de metricas fuera de horario. */
export async function sincronizarAhora() {
  return cola.add("metricas", {}, opcionesTrabajo);
}

/** Encola una busqueda de ideas fuera de horario. */
export async function buscarIdeasAhora() {
  return cola.add("ideas", {}, opcionesTrabajo);
}

export async function iniciarWorker() {
  // Limpieza diaria de archivos temporales y videos antiguos
  await cola.upsertJobScheduler("limpieza", { pattern: "0 4 * * *" }, { name: "limpiar" });

  // Las metricas de TikTok tardan en consolidarse: basta con revisarlas cada 6 h
  await cola.upsertJobScheduler("metricas", { pattern: "0 */6 * * *" }, { name: "metricas" });

  // Busqueda diaria de temas en Reddit (no hace nada si esta desactivada)
  await cola.upsertJobScheduler("ideas", { pattern: env.REDDIT_CRON }, { name: "ideas" });

  worker = new Worker(
    "historias",
    async (job) => {
      if (job.name === "crear-historia") return crearHistoria(job.data.serieId);
      if (job.name === "crear-suelta") return crearHistoriaSuelta(job.data.opciones);
      if (job.name === "publicar") return publicarHistoria(job.data.historiaId);
      if (job.name === "limpiar") return limpiarArchivos();
      if (job.name === "render-proyecto") return renderizarProyectoTrabajo(job.data.proyectoId);
      if (job.name === "montar-videoclip") return montarVideoclipTrabajo(job.data.proyectoId, job.data.opciones);
      if (job.name === "unir-canciones")
        return unirCancionesTrabajo(job.data.proyectoId, job.data.fuentes, job.data.cruce, job.data.montar);
      if (job.name === "render-variante") return renderizarVarianteTrabajo(job.data.varianteId);
      if (job.name === "continuar") return continuarHistoria(job.data.historiaId);
      if (job.name === "metricas") return sincronizarMetricas();
      if (job.name === "ideas") return buscarIdeasEnReddit();
    },
    { connection: conexion, concurrency: 1 }, // un render a la vez
  );

  return worker;
}

export async function detenerWorker() {
  await worker?.close();
  await cola.close();
}
