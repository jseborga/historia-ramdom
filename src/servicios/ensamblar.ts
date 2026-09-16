import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { generarKeywords, GuionSchema, criteriosVisuales, idiomaDeVoz, type Idioma } from "./guion.js";
import { buscarClips, CLIP_LARGO, type ClipInfo, type OpcionesMedios } from "./clips.js";
import { mediosDeCategoria } from "./categorias.js";
import { generarNarracion } from "./narracion.js";
import { mejorVozLocal } from "./voz.js";
import {
  ProyectoSchema,
  ClipPistaSchema,
  efectoDeClip,
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
  /** Criterios de búsqueda EN INGLÉS del ambiente general (categoría, planteamiento). */
  criterios?: string[];
  /** Dónde buscar y si entran fotos; vacío = lo que diga la categoría. */
  medios?: OpcionesMedios;
  /** Idioma del texto: fija la voz de reserva y el tono que se le pide. */
  idioma?: Idioma;
  /**
   * Clips que van al principio sí o sí, en este orden: la foto del producto,
   * lo que se haya subido para enseñarlo. El relleno automático solo cubre lo
   * que quede de narración después de ellos.
   */
  fijos?: ClipPista[];
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
    video.push(
      ClipPistaSchema.parse({ id: randomUUID(), clip: c, duracion, efecto: efectoDeClip(c, video.length) }),
    );
    usados.add(c.id);
    cubierto += duracion;
  };

  // Con `ganchoSeg` a cero no hay gancho que poner: quien llama ya tiene el
  // primer plano decidido (la foto del producto, por ejemplo).
  const gancho = ganchoSeg > 0 ? (barajar(candidatosGancho).find((c) => (c.duracion ?? ganchoSeg) >= 2) ?? candidatos[0]) : null;
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
  const p = await db.proyecto.findUniqueOrThrow({
    where: { id: proyectoId },
    include: { historia: { select: { guion: true } } },
  });
  const vozGuardada = (p.voz ?? {}) as Partial<VozPista>;
  // Un diálogo ya trae sus intervenciones y su reparto de voces; una narración
  // normal necesita texto.
  const esDialogo = vozGuardada.modo === "dialogo" && (vozGuardada.dialogo?.length ?? 0) > 0;
  const texto = (vozGuardada.texto ?? "").trim();
  if (!esDialogo && !texto) {
    throw new Error("La pista de voz no tiene texto: escribe o genera la narracion primero");
  }

  let voz: VozPista = ProyectoSchema.shape.voz.parse({
    ...vozGuardada,
    modo: esDialogo ? "dialogo" : "servidor",
    texto,
    idioma: opciones.idioma ?? vozGuardada.idioma ?? "es",
  });
  if (!esDialogo && (!voz.config || voz.config.proveedor === "local")) {
    // La voz de reserva, en el idioma de la pista: una historia en inglés
    // leída por una voz española no se entiende.
    const idiomaVoz = idiomaDeVoz(voz.idioma);
    voz = {
      ...voz,
      config: { proveedor: "local", modelo: "local", nombre: voz.config?.nombre ?? (await mejorVozLocal(idiomaVoz)) },
    };
  }

  // 1. La voz manda
  const vigente = voz.archivo && voz.huella === huellaVoz(voz) && voz.tramos.length;
  if (!vigente) voz = { ...voz, ...(await generarNarracion(proyectoId, voz)) };
  const total = voz.inicio + (voz.duracion ?? 0);

  // 2. El texto se acomoda a la voz
  const textos = textosDesdeNarracion(voz, total, opciones.lectura ?? "frases", {
    animacion: opciones.animacion ?? "fundido",
  });
  if (textos[0] && !esDialogo) {
    textos[0] = { ...textos[0], animacion: "zoom", estilo: { ...textos[0].estilo, tamano: 84, color: "#FFE500", posicion: "centro", negrita: true } };
  }

  // 3. El video es la ultima capa: clips largos al azar hasta cubrir la voz
  const frases = voz.tramos.map((t) => t.texto);
  const keywords = await generarKeywords([frases[0] ?? texto, ...frases.slice(1, 8)], "es");
  const largos = opciones.preferirLargos ?? true;
  // Ademas de lo que dice cada frase, el ambiente del genero: los criterios
  // vienen de la categoria y del planteamiento de la historia, si los hay.
  const guionHistoria = p.historia ? GuionSchema.safeParse(p.historia.guion) : null;
  // Dónde buscar: lo que pida quien llama y, si no, lo que use la categoría
  // (la ciencia mira a la NASA; las ideas admiten fotos).
  const medios: OpcionesMedios =
    opciones.medios ?? mediosDeCategoria(guionHistoria?.success ? guionHistoria.data.categoria : null);
  const criterios = (opciones.criterios?.length
    ? opciones.criterios
    : guionHistoria?.success
      ? criteriosVisuales(guionHistoria.data)
      : []
  ).slice(0, 6);
  const [gancho, ...resto] = await Promise.all([
    buscarClips([...keywords[0], "cinematic"].slice(0, 2).join(" "), { ...medios, largos: false }),
    ...keywords.slice(1).flatMap((ks) => ks.slice(0, 1).map((k) => buscarClips(k, { ...medios, largos }))),
    ...criterios.map((k) => buscarClips(k, { ...medios, largos })),
  ]);
  const conjunto = [...new Map(resto.flat().map((c) => [c.id, c])).values()];

  // Los clips fijos van delante y se quedan como están; el relleno cubre solo
  // lo que falte. Si ya cubren la narración entera, no se busca nada más.
  // Nunca pasan del largo de la narración: un plano sin voz encima es silencio.
  const fijos: ClipPista[] = [];
  let cubiertoFijo = 0;
  for (const c of (opciones.fijos ?? []).slice(0, 60)) {
    const hueco = total - cubiertoFijo;
    if (hueco < 0.5) break;
    fijos.push(c.duracion <= hueco ? c : { ...c, duracion: hueco });
    cubiertoFijo += Math.min(c.duracion, hueco);
  }
  const restante = total - cubiertoFijo;
  const relleno =
    restante > 0.05
      ? rellenarVideo(
          gancho.length ? gancho : conjunto,
          conjunto.length ? conjunto : gancho,
          restante,
          // Con clips fijos el gancho ya está puesto: el relleno es continuación.
          fijos.length ? 0 : (opciones.ganchoSeg ?? GANCHO_SEG),
        )
      : [];
  const video = [...fijos, ...relleno];

  await db.proyecto.update({
    where: { id: proyectoId },
    data: { escenas: video, textos, voz },
  });
  return { video, textos, voz, total };
}
