import { db } from "../db.js";
import { filasDeBase } from "./sadButTrueBase.js";
import { SadButTrueSchema, TONOS, type SadButTrue, type Tono } from "./sadButTrue.js";

/**
 * El banco de "Sad but true": de aquí sale un vídeo sin gastar una sola
 * llamada a la IA.
 *
 * Funciona al revés que el resto del estudio. En las historias la IA escribe
 * cada vez; aquí escribir es lo caro y lo lento, y el formato es tan corto que
 * lo que hace falta no es inventar de cero sino **tener de dónde sacar**. Así
 * que todo lo que se escribe una vez se queda: lo que redactó la IA, lo que se
 * pegó a mano y la base con la que arranca la app.
 *
 * El bombo de cada sorteo se llena con las palabras de las demás parejas **del
 * mismo tema**, que es lo que mantiene la ilusión: ocho cosas que se posponen
 * pasando de largo, no ocho cosas sin relación.
 */

/** Palabras que pasan por el bombo, contando la que gana. */
const BOMBO = 8;
/** Menos de esto no es un sorteo: es enseñar la respuesta con dos distracciones. */
const BOMBO_MINIMO = 4;

/** Mete la base la primera vez. Después no vuelve a tocar nada. */
export async function asegurarBase(): Promise<number> {
  if (await db.frase.count()) return 0;
  const filas = filasDeBase();
  const { count } = await db.frase.createMany({
    data: filas.map((f) => ({ ...f, fuente: "MANUAL" as const })),
    skipDuplicates: true,
  });
  return count;
}

export type FraseNueva = {
  tipo: "SORTEO" | "REMATE";
  palabra?: string;
  texto: string;
  /** Solo en las parejas: su propio cierre, si vino pegado a ella. */
  remate?: string;
  tema?: string;
  idioma?: string;
  tono?: string;
};

/**
 * Guarda lo que venga y devuelve cuántas eran nuevas. Las repetidas no son un
 * error: pegar dos veces la misma lista es lo más normal del mundo, y avisar
 * de ello no ayuda a nadie.
 */
export async function guardarFrases(
  frases: FraseNueva[],
  fuente: "MANUAL" | "IA" = "MANUAL",
): Promise<{ nuevas: number; repetidas: number }> {
  const limpias = frases
    .map((f) => ({
      tipo: f.tipo,
      palabra: (f.palabra ?? "").replace(/\s+/g, " ").trim(),
      texto: f.texto.replace(/\s+/g, " ").trim(),
      remate: (f.remate ?? "").replace(/\s+/g, " ").trim(),
      tema: (f.tema ?? "").replace(/\s+/g, " ").trim(),
      idioma: f.idioma ?? "es",
      tono: TONOS.includes((f.tono ?? "") as Tono) ? (f.tono as string) : "reflexiva",
      fuente,
    }))
    // Una pareja sin palabra no puede ganar un sorteo, y un texto vacío no es
    // nada: ni una ni otra entran.
    .filter((f) => f.texto && (f.tipo === "REMATE" || f.palabra));

  if (!limpias.length) return { nuevas: 0, repetidas: 0 };
  const { count } = await db.frase.createMany({ data: limpias, skipDuplicates: true });
  return { nuevas: count, repetidas: limpias.length - count };
}

/** Lo que escribió la IA se queda en el banco: la pareja y el remate. */
export async function guardarGuion(g: SadButTrue, tema: string, idioma: string) {
  return guardarFrases(
    [
      { tipo: "SORTEO", palabra: g.elegida, texto: g.frase, remate: g.remate, tema, idioma, tono: g.tono },
      { tipo: "REMATE", texto: g.remate, tono: g.tono, idioma },
    ],
    "IA",
  );
}

export type LineaPegada = {
  numero: number;
  palabra: string;
  frase: string;
  remate: string;
  /** Qué le pasa a esta línea, si le pasa algo. */
  error?: string;
};

/**
 * En qué orden vienen los campos de cada línea.
 *
 *   "palabra"  palabra ; frase ; remate      la palabra delante
 *   "frase"    frase ; remate ; sobre X      la palabra al final, con "sobre"
 *
 * Los dos existen porque las frases se escriben de las dos maneras. Con una
 * lista de cosas —"El gimnasio", "Ese libro"— la palabra sale primero sola.
 * Con sentencias en dos tiempos —"La paciencia es infinita ; la vida es
 * finita"— lo natural es escribir la frase y decir al final de qué iba.
 */
export type FormatoPegado = "palabra" | "frase";

/** "sobre la paciencia" → "la paciencia". Lo mismo en inglés. */
const SOBRE = /^(sobre|acerca de|about|on)\s+/i;
export const quitarSobre = (v: string) => v.replace(SOBRE, "").trim();

/**
 * Lo pegado a mano, una línea por cosa y los campos separados por `;`.
 *
 * Con el formato de la palabra delante:
 *
 *   palabra ; frase              una pareja del sorteo
 *   palabra ; frase ; remate     la pareja, con su cierre
 *
 * Con el de la palabra al final:
 *
 *   frase ; remate ; sobre X     la pareja de X, con su cierre
 *   frase ; sobre X              la pareja, y el cierre lo pone el banco
 *
 * Y en los dos, una línea sin ningún `;` es un remate suelto.
 *
 * El punto y coma es lo que distingue cuál es cuál, así que dentro de un texto
 * no puede haber otro: lo que sobra se junta con el campo del medio, y una
 * línea mal partida se ve en la vista previa antes de guardar nada. Las líneas
 * vacías y las que empiezan por `#` se saltan, que es lo que permite pegar una
 * lista con sus títulos dentro.
 */
export function analizarPegado(texto: string, formato: FormatoPegado = "palabra"): LineaPegada[] {
  const salida: LineaPegada[] = [];
  for (const [i, cruda] of texto.split(/\r?\n/).entries()) {
    const linea = cruda.trim();
    if (!linea || linea.startsWith("#")) continue;

    const partes = linea.split(";").map((x) => x.replace(/\s+/g, " ").trim());
    const fila: LineaPegada = { numero: i + 1, palabra: "", frase: "", remate: "" };

    if (partes.length === 1) {
      fila.remate = partes[0];
      if (partes[0].length < 8) fila.error = "Demasiado corto para ser un remate; ¿falta el ; de la frase?";
      salida.push(fila);
      continue;
    }

    if (formato === "frase") {
      // La palabra es siempre lo último; lo de en medio, el cierre.
      fila.palabra = quitarSobre(partes[partes.length - 1]);
      fila.frase = partes[0];
      fila.remate = partes.slice(1, -1).join("; ").trim();
      if (!fila.frase) fila.error = "Falta la frase, lo que va antes del primer ;";
      else if (!fila.palabra) fila.error = "Falta de qué va, lo que va después del último ;";
    } else {
      fila.palabra = partes[0];
      fila.frase = partes[1] ?? "";
      fila.remate = partes.slice(2).join("; ").trim();
      if (!fila.palabra) fila.error = "Falta la palabra, lo que va antes del primer ;";
      else if (!fila.frase) fila.error = "Falta la frase, lo que va después del primer ;";
    }
    // Lo que va al bombo se lee en una décima de segundo: cuatro palabras como
    // mucho ("Llamar a tu papá"). Si ahí ha caído una frase entera, la línea
    // está partida por donde no era.
    const cuantas = fila.palabra.split(/\s+/).filter(Boolean).length;
    if (!fila.error && fila.palabra.length > 40) {
      fila.error = `La palabra del bombo no puede pasar de 40 caracteres, y esta tiene ${fila.palabra.length}`;
    } else if (!fila.error && cuantas > 4) {
      fila.error =
        formato === "frase"
          ? "Lo de después del último ; tiene que decir de qué va, como «sobre la paciencia»; esto parece otra frase"
          : "Lo de antes del primer ; es la palabra del bombo, y esto parece una frase entera";
    }
    salida.push(fila);
  }
  return salida;
}

/** Las líneas buenas, ya como filas del banco. */
export function filasDePegado(
  lineas: LineaPegada[],
  datos: { tema?: string; idioma?: string; tono?: string },
): FraseNueva[] {
  const salida: FraseNueva[] = [];
  for (const l of lineas) {
    if (l.error) continue;
    if (l.palabra && l.frase) {
      // El cierre se guarda pegado a su pareja: "La paciencia es infinita" y
      // "la vida es finita" son la misma broma partida en dos, y separarlas es
      // contar el chiste a medias.
      salida.push({
        tipo: "SORTEO",
        palabra: l.palabra,
        texto: l.frase,
        remate: l.remate,
        tema: datos.tema,
        idioma: datos.idioma,
        tono: datos.tono,
      });
    }
    // Y además al montón, porque un buen cierre vale para más de una frase.
    if (l.remate) {
      salida.push({ tipo: "REMATE", texto: l.remate, idioma: datos.idioma, tono: datos.tono });
    }
  }
  return salida;
}

export type FiltroFrases = {
  tipo?: "SORTEO" | "REMATE";
  tema?: string;
  idioma?: string;
  buscar?: string;
};

export async function listarFrases(f: FiltroFrases = {}, limite = 300) {
  await asegurarBase();
  return db.frase.findMany({
    where: {
      ...(f.tipo ? { tipo: f.tipo } : {}),
      ...(f.tema ? { tema: f.tema } : {}),
      ...(f.idioma ? { idioma: f.idioma } : {}),
      ...(f.buscar
        ? {
            OR: [
              { palabra: { contains: f.buscar, mode: "insensitive" as const } },
              { texto: { contains: f.buscar, mode: "insensitive" as const } },
            ],
          }
        : {}),
    },
    orderBy: [{ tema: "asc" }, { creadaEn: "desc" }],
    take: limite,
  });
}

/** Los temas que hay, con cuántas parejas tiene cada uno. */
export async function temasDelBanco(idioma?: string) {
  await asegurarBase();
  const filas = await db.frase.groupBy({
    by: ["tema"],
    where: { tipo: "SORTEO", ...(idioma ? { idioma } : {}) },
    _count: { _all: true },
    orderBy: { tema: "asc" },
  });
  return filas.filter((f) => f.tema).map((f) => ({ tema: f.tema, cuantas: f._count._all }));
}

/** Una al azar de las que menos se han usado, para que no salga siempre la misma. */
function alAzar<T>(xs: T[]): T | undefined {
  return xs.length ? xs[Math.floor(Math.random() * xs.length)] : undefined;
}

/**
 * Saca un guion del banco, sin IA.
 *
 * Gana una pareja de las **menos usadas** —no una cualquiera—, porque con
 * cincuenta frases y sorteo puro la tercera vez ya se repite. Se baraja entre
 * las veinte menos gastadas para que tampoco sea un turno fijo.
 */
export async function sortearGuion(opciones: {
  tema?: string;
  tono?: Tono | "";
  idioma?: string;
} = {}): Promise<SadButTrue> {
  await asegurarBase();
  const idioma = opciones.idioma ?? "es";

  // Un tema con tres palabras no da para un sorteo, y mezclar temas rompe lo
  // único que sostiene el formato. Así que se sortea solo entre los temas que
  // llegan al mínimo, y si el pedido a mano no llega, se dice por qué.
  const temas = await temasDelBanco(idioma);
  const llenos = temas.filter((t) => t.cuantas >= BOMBO_MINIMO).map((t) => t.tema);

  if (opciones.tema) {
    const suyo = temas.find((t) => t.tema === opciones.tema);
    if (!suyo) {
      throw new Error(`No hay frases guardadas del tema "${opciones.tema}". Pega algunas en el banco.`);
    }
    if (suyo.cuantas < BOMBO_MINIMO) {
      throw new Error(
        `El tema "${opciones.tema}" solo tiene ${suyo.cuantas} palabra(s) y un sorteo necesita ${BOMBO_MINIMO}. ` +
          "Añade alguna más, o deja el tema en blanco para sortear entre todos.",
      );
    }
  } else if (!llenos.length) {
    throw new Error(
      `No hay ningún tema con al menos ${BOMBO_MINIMO} palabras. Pega unas cuantas de la misma familia y vuelve a intentarlo.`,
    );
  }

  const candidatas = await db.frase.findMany({
    where: { tipo: "SORTEO", idioma, tema: opciones.tema ? opciones.tema : { in: llenos } },
    orderBy: [{ usos: "asc" }, { creadaEn: "asc" }],
    take: 20,
  });
  const ganadora = alAzar(candidatas);
  if (!ganadora) throw new Error("El banco de frases está vacío. Pega algunas o escribe una con IA.");

  // El bombo, del mismo tema y sin la ganadora: si apareciera antes de ganar,
  // el final se ve venir.
  // Fuera la ganadora, y fuera cualquier otra fila que repita su palabra: con
  // dos frases distintas de "la confianza", excluir solo la fila ganadora
  // dejaba su palabra en el bombo y el final se veía venir.
  const hermanas = await db.frase.findMany({
    where: { tipo: "SORTEO", idioma, tema: ganadora.tema, palabra: { not: ganadora.palabra } },
    select: { palabra: true },
    take: 40,
  });
  const otras = [...new Set(hermanas.map((h) => h.palabra))].sort(() => Math.random() - 0.5);
  const palabras = [ganadora.palabra, ...otras.slice(0, BOMBO - 1)];

  // Si la pareja trae su propio cierre, ese y no otro: viene escrito para esa
  // frase. Solo cuando no lo trae se coge uno del montón.
  const suyo = ganadora.remate.trim();
  const remates = suyo
    ? []
    : await db.frase.findMany({
        where: { tipo: "REMATE", idioma, ...(opciones.tono ? { tono: opciones.tono } : {}) },
        orderBy: [{ usos: "asc" }, { creadaEn: "asc" }],
        take: 20,
      });
  const prestado = suyo ? null : alAzar(remates);
  if (!suyo && !prestado) throw new Error("No hay remates guardados para cerrar el vídeo.");

  // Usado es usado: se marca aquí y no al renderizar, porque lo que hay que
  // evitar es que la siguiente tirada devuelva lo mismo.
  const ahora = new Date();
  await db.frase.updateMany({
    where: { id: { in: [ganadora.id, ...(prestado ? [prestado.id] : [])] } },
    data: { usos: { increment: 1 }, usadaEn: ahora },
  });

  return SadButTrueSchema.parse({
    titulo: ganadora.tema || ganadora.palabra,
    palabras,
    elegida: ganadora.palabra,
    frase: ganadora.texto,
    remate: suyo || prestado!.texto,
    tono: TONOS.includes((prestado?.tono ?? ganadora.tono) as Tono)
      ? (prestado?.tono ?? ganadora.tono)
      : "reflexiva",
    keywords: palabrasDeBusqueda(ganadora.tema),
    hashtags: ["sadbuttrue"],
  });
}

/**
 * Con qué buscar el vídeo del medio cuando el guion no viene de la IA.
 *
 * Da igual lo que diga la frase: el plano del medio es un fondo, no una
 * ilustración. Estos ambientes pegan con cualquier cosa y no compiten con el
 * texto, que es lo único que hay que leer.
 */
const AMBIENTES = [
  ["rain window night", "empty street night", "city lights blur"],
  ["empty room light", "dust sunlight window", "old apartment"],
  ["ocean grey waves", "fog forest", "long road empty"],
  ["walking alone night", "subway window", "bus night city"],
];

export function palabrasDeBusqueda(tema: string): string[] {
  // Del tema sale siempre el mismo ambiente, no uno al azar: dos vídeos de la
  // misma familia se parecen entre ellos y se distinguen de los demás.
  const suma = [...tema].reduce((s, c) => s + c.charCodeAt(0), 0);
  return AMBIENTES[suma % AMBIENTES.length];
}
