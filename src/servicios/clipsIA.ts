import { z } from "zod";
import { buscarConEstado, type Busqueda, type ClipInfo, type EstadoBanco, type OpcionesMedios } from "./clips.js";
import {
  esMotor,
  extraerJSON,
  keywordsHeuristicas,
  motorDisponible,
  textoConMotor,
  type InformeMotor,
  type Motor,
} from "./guion.js";

/**
 * Buscar clips describiendo lo que se quiere ver, en vez de adivinar las
 * palabras en inglés que entiende cada banco.
 *
 * Dos pasos de IA, los dos con red: sin motor con clave, o si el modelo
 * falla, se cae en la heurística de palabras y se avisa.
 *   1. De la descripción («una abuela amasando pan al amanecer») a tres o
 *      cuatro búsquedas en inglés con ángulos distintos: lo literal, el lugar
 *      o el ambiente, un detalle de cerca, una imagen que lo evoque. Una sola
 *      búsqueda literal suele traer lo mismo que ya salía a mano.
 *   2. Con lo que trajeron los bancos, elegir y ordenar: cada pieza va con el
 *      título o las etiquetas que dio su banco, y el modelo dice cuáles
 *      encajan con lo pedido. Lo que no eligió se deja detrás, por si acaso.
 */
export type BusquedaIA = Busqueda & {
  /** Lo que de verdad se buscó en los bancos. */
  busquedas: string[];
  /** Cuántos de `clips`, desde el principio, eligió la IA como los que encajan. */
  destacados: number;
  /** Qué motor escribió (y si fue un sustituto). */
  informe: InformeMotor;
  aviso?: string;
};

const MAX_BUSQUEDAS = 4;
/** Cuántos candidatos se le enseñan al modelo para que ordene. */
const MAX_PARA_ORDENAR = 40;
/** Cuántos devuelve la búsqueda. */
const MAX_RESULTADOS = 36;

const BusquedasSchema = z.object({ busquedas: z.array(z.string().trim().min(1).max(60)).min(1).max(8) });
// Un número fuera de rango (un 0, un 999) se ignora; no tira toda la respuesta.
const OrdenSchema = z.object({ orden: z.array(z.number().int()).max(MAX_PARA_ORDENAR * 2) });

/** Para el aviso: un error de formato en una frase, no el volcado de zod. */
const mensaje = (e: unknown) =>
  e instanceof z.ZodError ? "la respuesta no tenía el formato pedido" : e instanceof Error ? e.message : String(e);

export async function buscarClipsConIA(
  descripcion: string,
  o: OpcionesMedios = {},
  motor?: string | null,
  idioma = "es",
): Promise<BusquedaIA> {
  const limpia = descripcion.replace(/\s+/g, " ").trim().slice(0, 400);
  const elegido = (motor && esMotor(motor) ? motor : null) ?? motorDisponible();
  const informe: InformeMotor = {};
  let aviso: string | undefined;

  let busquedas: string[];
  if (!elegido) {
    busquedas = [keywordsHeuristicas(limpia).join(" ")];
    aviso =
      "Sin motor de IA con clave: se buscó por las palabras de la descripción. " +
      "Pon una clave en Ajustes para que la IA proponga búsquedas y elija.";
  } else {
    try {
      busquedas = await proponerBusquedas(elegido, limpia, idioma, informe);
    } catch (e) {
      busquedas = [keywordsHeuristicas(limpia).join(" ")];
      aviso = `La IA no pudo proponer búsquedas (${mensaje(e)}); se buscó por las palabras de la descripción.`;
    }
  }

  const resultados = await Promise.all(busquedas.map((b) => buscarConEstado(b, o)));
  const clips = intercalar(resultados.map((r) => r.clips));
  const bancos = sumarBancos(resultados.flatMap((r) => r.bancos));

  let ordenados = clips;
  let destacados = 0;
  if (elegido && clips.length >= 3) {
    try {
      ({ clips: ordenados, destacados } = await ordenarConIA(elegido, limpia, clips, idioma, informe));
    } catch (e) {
      aviso ??= `La IA buscó, pero no pudo ordenar lo que volvió (${mensaje(e)}); va tal como lo dieron los bancos.`;
    }
  }

  return {
    clips: ordenados.slice(0, MAX_RESULTADOS),
    bancos,
    busquedas,
    destacados: Math.min(destacados, MAX_RESULTADOS),
    informe,
    ...(aviso ? { aviso } : {}),
  };
}

async function proponerBusquedas(motor: Motor, descripcion: string, idioma: string, informe: InformeMotor) {
  const prompt = [
    "Alguien describe lo que quiere ver en un vídeo vertical hecho con material de archivo (stock footage).",
    `Convierte la descripción en ${MAX_BUSQUEDAS} búsquedas EN INGLÉS para bancos de vídeo como Pexels, Pixabay o Coverr.`,
    "Cada búsqueda: de 1 a 3 palabras, concretas y visuales (cosas que se ven en el plano), sin verbos abstractos",
    "ni adjetivos de ánimo. Que cubran ángulos distintos: lo literal, el lugar o el ambiente, un detalle de cerca",
    "y una imagen que lo evoque. Sin nombres de personas ni marcas.",
    "Devuelve exactamente este JSON y nada más:",
    '{ "busquedas": ["rainy window night", "city street umbrella", "wet asphalt reflection", "woman walking rain"] }',
    "",
    `Descripción: «${descripcion}»`,
  ].join("\n");
  const crudo = await textoConMotor(motor, prompt, null, idioma, "bolivia", false, informe);
  const { busquedas } = BusquedasSchema.parse(extraerJSON(crudo));
  const limpias = [
    ...new Set(
      busquedas
        .map((b) =>
          b
            .toLowerCase()
            .replace(/[^\p{L}\p{N} '-]/gu, " ")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean),
    ),
  ];
  if (!limpias.length) throw new Error("el modelo no devolvió búsquedas");
  return limpias.slice(0, MAX_BUSQUEDAS);
}

async function ordenarConIA(
  motor: Motor,
  descripcion: string,
  clips: ClipInfo[],
  idioma: string,
  informe: InformeMotor,
): Promise<{ clips: ClipInfo[]; destacados: number }> {
  const muestra = clips.slice(0, MAX_PARA_ORDENAR);
  const lineas = muestra.map(
    (c, i) => `${i + 1}. [${c.fuente}${c.tipo === "imagen" ? ", foto" : ""}] ${c.titulo ?? "(el banco no la describe)"}`,
  );
  const prompt = [
    "Se buscó material de archivo para esta descripción de lo que se quiere ver en un vídeo vertical:",
    `«${descripcion}»`,
    "",
    "Estos son los clips que trajeron los bancos, cada uno con la descripción o las etiquetas que da su banco.",
    "Elige los que de verdad ilustran lo pedido y devuélvelos del que mejor encaja al que menos, hasta 24.",
    "Descarta los que no tengan que ver; en caso de duda, fuera antes que de más.",
    'Devuelve exactamente este JSON y nada más: { "orden": [3, 1, 12] }',
    "",
    ...lineas,
  ].join("\n");
  const crudo = await textoConMotor(motor, prompt, null, idioma, "bolivia", false, informe);
  const { orden } = OrdenSchema.parse(extraerJSON(crudo));
  const elegidos = [...new Set(orden)].filter((n) => n >= 1 && n <= muestra.length).map((n) => muestra[n - 1]);
  const resto = clips.filter((c) => !elegidos.includes(c));
  return { clips: [...elegidos, ...resto], destacados: elegidos.length };
}

/**
 * Mezcla varias búsquedas turnándose: el primero de cada una, luego el
 * segundo... Así ninguna búsqueda tapa a las demás y el mismo clip no sale
 * dos veces.
 */
function intercalar(listas: ClipInfo[][]): ClipInfo[] {
  const vistos = new Set<string>();
  const salida: ClipInfo[] = [];
  const largo = Math.max(0, ...listas.map((l) => l.length));
  for (let i = 0; i < largo; i++) {
    for (const lista of listas) {
      const c = lista[i];
      if (c && !vistos.has(c.id)) {
        vistos.add(c.id);
        salida.push(c);
      }
    }
  }
  return salida;
}

/** Qué hizo cada banco sumando las búsquedas; un error se conserva. */
function sumarBancos(estados: EstadoBanco[]): EstadoBanco[] {
  const porBanco = new Map<string, EstadoBanco>();
  for (const e of estados) {
    const previo = porBanco.get(e.banco);
    porBanco.set(e.banco, {
      banco: e.banco,
      encontrados: (previo?.encontrados ?? 0) + e.encontrados,
      ...(previo?.error ?? e.error ? { error: previo?.error ?? e.error } : {}),
    });
  }
  return [...porBanco.values()];
}
