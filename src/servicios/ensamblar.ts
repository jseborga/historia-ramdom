import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { generarKeywords } from "./guion.js";
import { buscarClips, CLIP_LARGO, type ClipInfo } from "./clips.js";
import { generarNarracion } from "./narracion.js";
import { mejorVozLocal } from "./voz.js";
import {
  ProyectoSchema,
  ClipPistaSchema,
  textosDesdeNarracion,
  huellaVoz,
  type ClipPista,
  type VozPista,
} from "./proyecto.js";

/** El gancho: pocos segundos y un plano que llame la atencion. */
export const GANCHO_SEG = 4;

export type OpcionesEnsamblado = {
  /** Clips de 30 s o mas siempre que los haya. */
  preferirLargos?: boolean;
  ganchoSeg?: number;
  /** Rotulos con la frase entera o por bloques. */
  lectura?: "frases" | "bloques";
  animacion?: "fundido" | "resaltar" | "ninguna";
};

const barajar = <T>(xs: T[]) => [...xs].sort(() => Math.random() - 0.5);

/**
 * Rellena la pista de video hasta `total` segundos con clips al azar del
 * conjunto, cada uno con su DURACION REAL de origen (nunca mas larga) y sin
 * repetir mientras haya donde elegir. El primero es el gancho, corto.
 */
export function rellenarVideo(
  candidatosGancho: ClipInfo[],
  candidatos: ClipInfo[],
  total: number,
  ganchoSeg = GANCHO_SEG,
): ClipPista[] {
  const video: ClipPista[] = [];
  const usados = new Set<string>();
  let cubierto = 0;

  const meter = (c: ClipInfo, maximo: number) => {
    const real = c.duracion && c.duracion > 0 ? c.duracion : maximo;
    const duracion = Math.max(0.5, Math.min(real, maximo, total - cubierto));
    video.push(ClipPistaSchema.parse({ id: randomUUID(), clip: c, duracion, efecto: video.length ? "ninguno" : "zoomLento" }));
    usados.add(c.id);
    cubierto += duracion;
  };

  const gancho = barajar(candidatosGancho).find((c) => (c.duracion ?? ganchoSeg) >= 2) ?? candidatos[0];
  if (gancho) meter(gancho, ganchoSeg);

  // Primero los largos, y cada uno entero; si se acaban, se repite el conjunto.
  const largos = candidatos.filter((c) => (c.duracion ?? 0) >= CLIP_LARGO);
  const cola = [...barajar(largos), ...barajar(candidatos.filter((c) => !largos.includes(c)))];
  let vueltas = 0;
  while (cubierto < total - 0.05 && vueltas < 3) {
    let avanzo = false;
    for (const c of cola) {
      if (cubierto >= total - 0.05) break;
      if (usados.has(c.id) && vueltas === 0) continue;
      meter(c, 180);
      avanzo = true;
    }
    if (!avanzo) break;
    vueltas++;
  }
  // Sin clips: un fondo de color del largo que falte, para que nunca quede vacio.
  if (cubierto < total - 0.05) {
    video.push(ClipPistaSchema.parse({ id: randomUUID(), duracion: Math.max(0.5, total - cubierto) }));
  }
  return video;
}

/**
 * Ensambla un proyecto con la narracion al mando:
 *   1. genera la voz (una sola, la mejor local si no se eligio otra) y mide sus frases,
 *   2. coloca un rotulo por frase exactamente donde suena,
 *   3. rellena el video hasta esa duracion con clips largos al azar, gancho corto primero.
 */
export async function ensamblarProyecto(proyectoId: string, opciones: OpcionesEnsamblado = {}) {
  const p = await db.proyecto.findUniqueOrThrow({ where: { id: proyectoId } });
  const vozGuardada = (p.voz ?? {}) as Partial<VozPista>;
  const texto = (vozGuardada.texto ?? "").trim();
  if (!texto) throw new Error("La pista de voz no tiene texto: escribe o genera la narracion primero");

  let voz: VozPista = ProyectoSchema.shape.voz.parse({ ...vozGuardada, modo: "servidor", texto });
  if (!voz.config || voz.config.proveedor === "local") {
    voz = { ...voz, config: { proveedor: "local", modelo: "local", nombre: voz.config?.nombre ?? (await mejorVozLocal("es")) } };
  }

  // 1. La voz manda
  const vigente = voz.archivo && voz.huella === huellaVoz(voz) && voz.tramos.length;
  if (!vigente) voz = { ...voz, ...(await generarNarracion(proyectoId, voz)) };
  const total = voz.inicio + (voz.duracion ?? 0);

  // 2. El texto se acomoda a la voz
  const textos = textosDesdeNarracion(voz, total, opciones.lectura ?? "frases", {
    animacion: opciones.animacion ?? "fundido",
  });
  if (textos[0]) {
    textos[0] = { ...textos[0], animacion: "zoom", estilo: { ...textos[0].estilo, tamano: 84, color: "#FFE500", posicion: "centro", negrita: true } };
  }

  // 3. El video es la ultima capa: clips largos al azar hasta cubrir la voz
  const frases = voz.tramos.map((t) => t.texto);
  const keywords = await generarKeywords([frases[0] ?? texto, ...frases.slice(1, 8)], "es");
  const largos = opciones.preferirLargos ?? true;
  const [gancho, ...resto] = await Promise.all([
    buscarClips([...keywords[0], "cinematic"].slice(0, 2).join(" "), false),
    ...keywords.slice(1).flatMap((ks) => ks.slice(0, 1).map((k) => buscarClips(k, largos))),
  ]);
  const conjunto = [...new Map(resto.flat().map((c) => [c.id, c])).values()];
  const video = rellenarVideo(gancho.length ? gancho : conjunto, conjunto.length ? conjunto : gancho, total, opciones.ganchoSeg ?? GANCHO_SEG);

  await db.proyecto.update({
    where: { id: proyectoId },
    data: { escenas: video, textos, voz },
  });
  return { video, textos, voz, total };
}
