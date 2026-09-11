import { Worker } from "bullmq";
import { conexion, cola, opcionesTrabajo } from "./conexion.js";
import {
  crearHistoria,
  crearHistoriaSuelta,
  publicarHistoria,
  limpiarArchivos,
  type OpcionesHistoria,
} from "./trabajos.js";

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

export async function iniciarWorker() {
  // Limpieza diaria de archivos temporales y videos antiguos
  await cola.upsertJobScheduler("limpieza", { pattern: "0 4 * * *" }, { name: "limpiar" });

  worker = new Worker(
    "historias",
    async (job) => {
      if (job.name === "crear-historia") return crearHistoria(job.data.serieId);
      if (job.name === "crear-suelta") return crearHistoriaSuelta(job.data.opciones);
      if (job.name === "publicar") return publicarHistoria(job.data.historiaId);
      if (job.name === "limpiar") return limpiarArchivos();
    },
    { connection: conexion, concurrency: 1 }, // un render a la vez
  );

  return worker;
}

export async function detenerWorker() {
  await worker?.close();
  await cola.close();
}
