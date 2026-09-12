import { access } from "node:fs/promises";

/**
 * Tipografias disponibles para los rotulos. Son las que instala el Dockerfile;
 * libass las encuentra por su nombre de familia, y el navegador las carga
 * desde /api/fuentes/:id para que la vista previa use la misma letra.
 */
export type Fuente = { id: string; nombre: string; archivo: string; estilo: "sans" | "serif" };

type Candidata = Omit<Fuente, "archivo"> & { rutas: string[] };

const CANDIDATAS: Candidata[] = [
  { id: "dejavu-serif", nombre: "DejaVu Serif", estilo: "serif", rutas: ["/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf"] },
  { id: "dejavu-sans", nombre: "DejaVu Sans", estilo: "sans", rutas: ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"] },
  { id: "liberation-sans", nombre: "Liberation Sans", estilo: "sans", rutas: [
    "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  ] },
  { id: "liberation-serif", nombre: "Liberation Serif", estilo: "serif", rutas: [
    "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSerif-Regular.ttf",
  ] },
  { id: "lato", nombre: "Lato", estilo: "sans", rutas: ["/usr/share/fonts/truetype/lato/Lato-Regular.ttf"] },
  { id: "open-sans", nombre: "Open Sans", estilo: "sans", rutas: ["/usr/share/fonts/truetype/open-sans/OpenSans-Regular.ttf"] },
  { id: "roboto", nombre: "Roboto", estilo: "sans", rutas: [
    "/usr/share/fonts/truetype/roboto/unhinted/RobotoTTF/Roboto-Regular.ttf",
    "/usr/share/fonts/truetype/roboto/hinted/Roboto-Regular.ttf",
  ] },
];

export const FUENTE_POR_DEFECTO = "DejaVu Serif";

let cache: Fuente[] | null = null;

/** Solo las que existen de verdad en esta maquina; se comprueba una vez. */
export async function fuentesDisponibles(): Promise<Fuente[]> {
  if (cache) return cache;
  const salida: Fuente[] = [];
  for (const c of CANDIDATAS) {
    for (const ruta of c.rutas) {
      const existe = await access(ruta).then(() => true, () => false);
      if (existe) {
        salida.push({ id: c.id, nombre: c.nombre, estilo: c.estilo, archivo: ruta });
        break;
      }
    }
  }
  cache = salida;
  return salida;
}

/** El archivo se resuelve por id del catalogo: ninguna ruta viene del navegador. */
export async function archivoDeFuente(id: string) {
  return (await fuentesDisponibles()).find((f) => f.id === id)?.archivo ?? null;
}

export const nombresDeFuentes = async () => (await fuentesDisponibles()).map((f) => f.nombre);
