import { z } from "zod";
import { db } from "../db.js";
import {
  LIBROS,
  citasEn,
  clavesQueFaltan,
  conCita,
  formatearCita,
  leerCita,
  libroPorNombre,
  libroPorNumero,
  normalizar,
  ordenDe,
  pasajeValido,
  sinCitaFinal,
  textoDelPasaje,
  type Pasaje,
  type Testamento,
} from "./biblia.js";
import { REFERENCIAS_BASE } from "./bibliaReferencias.js";
import { palabrasDeBusqueda } from "./bancoFrases.js";
import { esMotor, extraerJSON, textoConMotor, type InformeMotor } from "./guion.js";
import { SadButTrueSchema, type SadButTrue } from "./sadButTrue.js";

/**
 * «Aprendiendo con la Biblia»: la serie que recorre la Biblia en orden, de
 * Génesis a Apocalipsis, un dato curioso por vídeo.
 *
 * Lo que la distingue del resto de Sad but true es de dónde sale la cita. En
 * las demás secciones el texto es libre; aquí cada vídeo sale de una
 * **referencia guardada** —libro, capítulo y versículos, comprobados contra
 * la Reina-Valera 1909 que lleva la app— y la cita que se ve en pantalla la
 * escribe el servidor desde ese pasaje. Lo que completa la IA (la palabra del
 * sorteo, la frase y el cierre) lo escribe leyendo el versículo literal, no
 * de memoria, y las citas que ponga en el cierre se comprueban igual.
 */

export const TITULO_SERIE = "Aprendiendo con la Biblia";

export type Rango = "todo" | Testamento;
export const RANGOS = ["todo", "AT", "NT"] as const;

type Fila = Awaited<ReturnType<typeof db.referenciaBiblica.findFirstOrThrow>>;

const pasajeDe = (r: Pick<Fila, "libro" | "capitulo" | "versiculo" | "capituloFin" | "versiculoFin">): Pasaje => ({
  libro: r.libro,
  capitulo: r.capitulo,
  versiculo: r.versiculo,
  capituloFin: r.capituloFin,
  versiculoFin: r.versiculoFin,
});

export type EstadoReferencia = "pendiente" | "revisar" | "lista";

/** Qué le falta para poder salir en un vídeo, dicho para arreglarlo. */
function avisosDe(r: Pick<Fila, "palabra" | "frase" | "remate">): string[] {
  const avisos: string[] = [];
  if (r.palabra && r.frase && !normalizar(r.frase).startsWith(normalizar(r.palabra))) {
    avisos.push("La frase tiene que empezar por la palabra del sorteo.");
  }
  for (const c of citasEn(r.remate)) {
    if (!c.cita) avisos.push(`La cita «${c.original}» del cierre no existe en la Reina-Valera 1909.`);
  }
  if (r.palabra.length > 40) avisos.push("La palabra del sorteo es demasiado larga (40 letras como mucho).");
  return avisos;
}

function estadoDe(r: Pick<Fila, "palabra" | "frase" | "remate">): EstadoReferencia {
  if (!r.palabra.trim() || !r.frase.trim() || !r.remate.trim()) return "pendiente";
  return avisosDe(r).length ? "revisar" : "lista";
}

/** La referencia como la ve la pantalla: con su cita, su texto y su estado. */
export function vista(r: Fila) {
  const p = pasajeDe(r);
  const libro = libroPorNumero(r.libro);
  return {
    ...r,
    cita: formatearCita(p),
    libroNombre: libro.nombre,
    testamento: libro.testamento,
    texto: textoDelPasaje(p),
    citasRemate: citasEn(r.remate),
    estado: estadoDe(r),
    avisos: avisosDe(r),
  };
}
export type VistaReferencia = ReturnType<typeof vista>;

/**
 * Mete la base la primera vez (tabla vacía). Solo entra lo que pasa la
 * comprobación: cita que exista y palabras clave que estén en el texto.
 */
export async function asegurarReferencias(): Promise<number> {
  if (await db.referenciaBiblica.count()) return 0;
  const filas = REFERENCIAS_BASE.flatMap((b) => {
    const p = leerCita(b.cita);
    if (!p || clavesQueFaltan(p, b.claves).length) return [];
    return [
      {
        ...p,
        orden: ordenDe(p),
        tema: b.tema,
        dato: b.dato,
        palabra: b.palabra ?? "",
        frase: b.frase ?? "",
        remate: b.remate ?? "",
        tono: b.tono ?? "historico",
        fuente: "MANUAL" as const,
      },
    ];
  });
  const { count } = await db.referenciaBiblica.createMany({ data: filas, skipDuplicates: true });
  return count;
}

const enRango = (libro: number, rango: Rango) => rango === "todo" || libroPorNumero(libro).testamento === rango;

export type FiltroReferencias = { rango?: Rango; libro?: number; estado?: EstadoReferencia | ""; q?: string };

export async function listarReferencias(f: FiltroReferencias = {}) {
  await asegurarReferencias();
  const rango = f.rango ?? "todo";
  const todas = (await db.referenciaBiblica.findMany({ orderBy: [{ orden: "asc" }, { capituloFin: "asc" }] }))
    .filter((r) => enRango(r.libro, rango))
    .map(vista);
  const q = f.q ? normalizar(f.q) : "";
  const referencias = todas.filter(
    (r) =>
      (!f.libro || r.libro === f.libro) &&
      (!f.estado || r.estado === f.estado) &&
      (!q || normalizar(`${r.cita} ${r.tema} ${r.dato} ${r.palabra} ${r.frase} ${r.remate}`).includes(q)),
  );
  const listas = todas.filter((r) => r.estado === "lista");
  return {
    referencias,
    cuentas: {
      total: todas.length,
      listas: listas.length,
      pendientes: todas.filter((r) => r.estado === "pendiente").length,
      revisar: todas.filter((r) => r.estado === "revisar").length,
      publicadas: todas.filter((r) => r.usos > 0).length,
    },
    siguiente: siguienteDe(todas),
    /** Los libros que tienen alguna referencia, para el filtro. */
    libros: [...new Set(todas.map((r) => r.libro))].map((n) => ({ numero: n, nombre: libroPorNumero(n).nombre })),
  };
}

/**
 * La que toca: la primera lista, en orden, que todavía no salió. Cuando ya
 * salieron todas, la serie vuelve a empezar por la menos usada.
 */
function siguienteDe(todas: VistaReferencia[]): VistaReferencia | null {
  const listas = todas.filter((r) => r.estado === "lista");
  const nueva = listas.find((r) => r.usos === 0);
  if (nueva) return nueva;
  const menos = Math.min(...listas.map((r) => r.usos));
  return listas.find((r) => r.usos === menos) ?? null;
}

export async function siguienteReferencia(rango: Rango = "todo") {
  return (await listarReferencias({ rango })).siguiente;
}

// ---------------------------------------------------------------------------
// Crear, editar y borrar
// ---------------------------------------------------------------------------

export const CambioReferencia = z
  .object({
    cita: z.string().min(3).max(60),
    tema: z.string().max(80),
    dato: z.string().max(400),
    palabra: z.string().max(40),
    frase: z.string().max(300),
    remate: z.string().max(300),
    tono: z.enum(["aliento", "historico"]),
  })
  .partial();
export type CambioReferencia = z.infer<typeof CambioReferencia>;

function pasajeDeCita(cita: string): Pasaje {
  const p = leerCita(cita);
  if (!p) throw new Error(`«${cita}» no existe en la Reina-Valera 1909. Revisa el libro, el capítulo y el versículo.`);
  return p;
}

/** Lo que se escribe, ya limpio: la frase va sin cita, que la pone la app. */
function limpio(c: CambioReferencia) {
  const t = (v: string | undefined) => (v === undefined ? undefined : v.replace(/\s+/g, " ").trim());
  return {
    tema: t(c.tema),
    dato: t(c.dato),
    palabra: t(c.palabra),
    frase: c.frase === undefined ? undefined : sinCitaFinal(t(c.frase)!),
    remate: t(c.remate),
    tono: c.tono,
  };
}

export async function crearReferencia(c: CambioReferencia & { cita: string }, fuente: "MANUAL" | "IA" = "MANUAL") {
  const p = pasajeDeCita(c.cita);
  const ya = await db.referenciaBiblica.findUnique({
    where: { libro_capitulo_versiculo_capituloFin_versiculoFin: p },
  });
  if (ya) throw new Error(`${formatearCita(p)} ya está guardada.`);
  const datos = limpio(c);
  const r = await db.referenciaBiblica.create({
    data: {
      ...p,
      orden: ordenDe(p),
      tema: datos.tema ?? "",
      dato: datos.dato ?? "",
      palabra: datos.palabra ?? "",
      frase: datos.frase ?? "",
      remate: datos.remate ?? "",
      tono: datos.tono ?? "historico",
      fuente,
    },
  });
  return vista(r);
}

export async function editarReferencia(id: string, c: CambioReferencia) {
  const pasaje = c.cita ? pasajeDeCita(c.cita) : null;
  const r = await db.referenciaBiblica.update({
    where: { id },
    data: { ...limpio(c), ...(pasaje ? { ...pasaje, orden: ordenDe(pasaje) } : {}) },
  });
  return vista(r);
}

export async function borrarReferencia(id: string) {
  await db.referenciaBiblica.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// El guion de un vídeo
// ---------------------------------------------------------------------------

/**
 * Las palabras del bombo: las de las referencias más cercanas en la Biblia,
 * primero del mismo libro. Si no hay bastantes con palabra, los nombres de los
 * libros vecinos, que también son de la familia.
 */
async function bombo(r: Fila): Promise<string[]> {
  const otras = await db.referenciaBiblica.findMany({
    where: { id: { not: r.id }, palabra: { not: "" } },
    select: { palabra: true, orden: true, libro: true },
  });
  const propia = normalizar(r.palabra);
  const cerca = otras
    .filter((o) => normalizar(o.palabra) !== propia)
    .sort((a, b) => Number(b.libro === r.libro) - Number(a.libro === r.libro) || Math.abs(a.orden - r.orden) - Math.abs(b.orden - r.orden));
  const palabras: string[] = [];
  for (const o of cerca) {
    if (palabras.length >= 7) break;
    if (!palabras.some((p) => normalizar(p) === normalizar(o.palabra))) palabras.push(o.palabra);
  }
  for (const l of [...LIBROS].sort((a, b) => Math.abs(a.numero - r.libro) - Math.abs(b.numero - r.libro))) {
    if (palabras.length >= 7) break;
    if (l.numero !== r.libro) palabras.push(l.nombre);
  }
  return [r.palabra, ...palabras];
}

/** El guion de Sad but true de una referencia, con su título de serie. */
export async function guionDeReferencia(id: string, titulo = TITULO_SERIE): Promise<SadButTrue & { versiculo: string; cita: string }> {
  const r = await db.referenciaBiblica.findUniqueOrThrow({ where: { id } });
  const v = vista(r);
  if (v.estado === "pendiente") throw new Error(`${v.cita} todavía no está completa: le falta la palabra, la frase o el cierre.`);
  if (v.estado === "revisar") throw new Error(`${v.cita}: ${v.avisos.join(" ")}`);
  const p = pasajeDe(r);
  const guion = SadButTrueSchema.parse({
    titulo: `${titulo} · ${v.cita}`,
    seccion: "biblia",
    tema: v.libroNombre,
    palabras: await bombo(r),
    elegida: r.palabra,
    frase: conCita(r.frase, p),
    remate: r.remate,
    tono: r.tono === "aliento" ? "aliento" : "historico",
    keywords: palabrasDeBusqueda(r.tema || v.libroNombre, "biblia"),
    hashtags: ["aprendiendoconlabiblia", "biblia", normalizar(v.libroNombre).replace(/\s+/g, "")],
    referenciaId: r.id,
    intro: { titulo, subtitulo: v.libroNombre },
  });
  return { ...guion, versiculo: v.texto, cita: v.cita };
}

/**
 * Antes de montar: la cita de la frase sale del pasaje guardado (la que venga
 * escrita se quita), y las del cierre tienen que existir.
 */
export async function asegurarCitas(g: SadButTrue): Promise<{ guion: SadButTrue; cita: string | null; versiculo: string | null }> {
  const malas = (t: string) => citasEn(t).filter((c) => !c.cita).map((c) => c.original);
  if (g.referenciaId) {
    const r = await db.referenciaBiblica.findUniqueOrThrow({ where: { id: g.referenciaId } });
    const p = pasajeDe(r);
    const fallan = malas(g.remate);
    if (fallan.length) throw new Error(`No existe en la Reina-Valera 1909: ${fallan.join(", ")}. Corrige el cierre.`);
    return {
      guion: { ...g, frase: conCita(g.frase, p), intro: g.intro ?? { titulo: TITULO_SERIE, subtitulo: libroPorNumero(r.libro).nombre } },
      cita: formatearCita(p),
      versiculo: textoDelPasaje(p),
    };
  }
  if (g.seccion === "biblia") {
    const fallan = [...malas(g.frase), ...malas(g.remate)];
    if (fallan.length) throw new Error(`No existe en la Reina-Valera 1909: ${fallan.join(", ")}.`);
  }
  return { guion: g, cita: null, versiculo: null };
}

export async function marcarUsada(id: string) {
  await db.referenciaBiblica.update({ where: { id }, data: { usos: { increment: 1 }, usadaEn: new Date() } });
}

// ---------------------------------------------------------------------------
// Con IA
// ---------------------------------------------------------------------------

const ComplementoIA = z.object({
  id: z.string(),
  palabra: z.string().max(60),
  frase: z.string().max(400),
  remate: z.string().max(400),
  tono: z.string().optional(),
});

/**
 * Completa referencias pendientes con la IA: la palabra del sorteo, la frase
 * y el cierre. El modelo recibe el **versículo literal** de cada una, no solo
 * la cita: escribe sobre lo que dice el texto, no sobre lo que recuerda.
 *
 * Lo que devuelve se comprueba igual que lo escrito a mano: la frase empieza
 * por su palabra y las citas del cierre existen; si no, se guarda igual pero
 * queda «para revisar» y no sale en la serie hasta que se corrija.
 */
export async function completarConIA(o: {
  ids?: string[];
  cuantas?: number;
  rango?: Rango;
  motor: string;
  modelo?: string | null;
  tono?: "aliento" | "historico" | "";
  rehacer?: boolean;
}) {
  if (!esMotor(o.motor)) throw new Error(`Motor desconocido: ${o.motor}`);
  await asegurarReferencias();
  const todas = await db.referenciaBiblica.findMany({ orderBy: { orden: "asc" } });
  const elegidas = o.ids?.length
    ? todas.filter((r) => o.ids!.includes(r.id))
    : todas
        .filter((r) => enRango(r.libro, o.rango ?? "todo"))
        .filter((r) => o.rehacer || estadoDe(r) === "pendiente")
        .slice(0, Math.min(Math.max(o.cuantas ?? 6, 1), 10));
  if (!elegidas.length) return { completadas: [], motorUsado: null as string | null, aviso: "No hay referencias pendientes." };

  const bloques = elegidas.map((r) => {
    const v = vista(r);
    return [`id: ${r.id}`, `cita: ${v.cita}`, `texto (Reina-Valera 1909): «${v.texto.slice(0, 900)}»`, r.dato ? `lo curioso: ${r.dato}` : ""]
      .filter(Boolean)
      .join("\n");
  });
  const prompt = [
    "Vas a completar referencias de la serie de vídeos cortos «Aprendiendo con la Biblia»: datos curiosos de la Biblia",
    "que hoy no pasarían por buena práctica cristiana, contados con respeto. Cada vídeo: un sorteo de palabras sobre negro",
    "que se para en una, la frase sobre un vídeo, y un cierre sobre negro.",
    "",
    "Para CADA referencia escribe:",
    "- palabra: de una a tres palabras con las que EMPIEZA la frase (lo que se sortea). Ejemplo: 'Los mariscos'.",
    "- frase: lo que dice ESE texto, contado en una o dos líneas (máximo veinte palabras), empezando por la palabra.",
    "  Solo lo que está en el texto que te doy: nada de detalles que no aparezcan ahí. SIN cita: la app la pone sola.",
    o.tono === "aliento"
      ? "- remate: un cierre de aliento (esperanza), de menos de quince palabras."
      : o.tono === "historico"
        ? "- remate: un cierre histórico (el contexto de la época o qué pasó después con esa costumbre), de menos de quince palabras."
        : "- remate: un cierre de aliento (esperanza) o histórico (el contexto de la época), el que mejor le vaya; menos de quince palabras.",
    "  Si el cierre cita otro versículo, ponlo entre paréntesis como '(Marcos 7:19)' y SOLO si estás seguro de que existe y dice eso;",
    "  si dudas, mejor un cierre sin cita. Nunca una burla de la fe ni de quien cree, ni contra el pueblo judío.",
    "- tono: 'aliento' o 'historico', según el cierre.",
    "",
    "Las referencias:",
    "",
    bloques.join("\n\n"),
    "",
    'Devuelve exactamente este JSON: { "referencias": [ { "id": "...", "palabra": "...", "frase": "...", "remate": "...", "tono": "aliento|historico" } ] }',
  ].join("\n");

  const informe: InformeMotor = {};
  const crudo = await textoConMotor(o.motor, prompt, o.modelo, "es", "bolivia", false, informe);
  if (!crudo) throw new Error(`El motor ${informe.motor ?? o.motor} no devolvió contenido`);
  const datos = extraerJSON(crudo) as { referencias?: unknown[] } | unknown[];
  const lista = (Array.isArray(datos) ? datos : (datos?.referencias ?? [])) as unknown[];

  const completadas: VistaReferencia[] = [];
  for (const x of lista) {
    const c = ComplementoIA.safeParse(x);
    if (!c.success) continue;
    const r = elegidas.find((e) => e.id === c.data.id);
    if (!r) continue;
    const actualizada = await db.referenciaBiblica.update({
      where: { id: r.id },
      data: {
        palabra: c.data.palabra.replace(/\s+/g, " ").trim().slice(0, 40),
        frase: sinCitaFinal(c.data.frase.replace(/\s+/g, " ").trim()),
        remate: c.data.remate.replace(/\s+/g, " ").trim(),
        tono: c.data.tono === "aliento" ? "aliento" : "historico",
        fuente: "IA",
      },
    });
    completadas.push(vista(actualizada));
  }
  return { completadas, motorUsado: informe.motor ?? o.motor, aviso: informe.aviso ?? null };
}

const PropuestaIA = z.object({
  cita: z.string().max(60),
  claves: z.array(z.string().max(40)).min(1).max(5),
  tema: z.string().max(80).default(""),
  dato: z.string().max(400).default(""),
});

/**
 * Busca más referencias con la IA en un libro. La IA propone la cita y unas
 * palabras que aparecen tal cual en el versículo; la app comprueba que la
 * cita exista y que esas palabras estén en el texto de 1909. Lo que no pasa,
 * no entra: así una cita inventada o con el número cambiado se queda fuera.
 */
export async function proponerConIA(o: { libro: number | string; cuantas?: number; motor: string; modelo?: string | null }) {
  if (!esMotor(o.motor)) throw new Error(`Motor desconocido: ${o.motor}`);
  const libro = typeof o.libro === "number" ? libroPorNumero(o.libro) : libroPorNombre(o.libro);
  if (!libro) throw new Error("Ese libro no existe");
  const ya = (await db.referenciaBiblica.findMany({ where: { libro: libro.numero } })).map((r) => formatearCita(pasajeDe(r)));
  const cuantas = Math.min(Math.max(o.cuantas ?? 8, 1), 15);

  const prompt = [
    `Busca en el libro de ${libro.nombre} ${cuantas} pasajes con datos curiosos para la serie «Aprendiendo con la Biblia»:`,
    "leyes, castigos, costumbres o hechos que hoy no pasarían por buena práctica cristiana, o que sorprenden al leerlos.",
    ya.length ? `Ya están guardados (no los repitas): ${ya.join(", ")}.` : "",
    "",
    "Para cada uno:",
    `- cita: libro capítulo:versículo, o un rango corto ('${libro.nombre} 3:1-4'). La numeración de la Reina-Valera 1909.`,
    "- claves: de 2 a 4 palabras que aparecen TAL CUAL en ese versículo en la Reina-Valera (la app las busca en el texto",
    "  para comprobar la cita; si no están, la descarta). Mejor sustantivos poco comunes.",
    "- tema: la familia, en tres o cuatro palabras.",
    "- dato: lo curioso, en una línea, contado con respeto.",
    "",
    'Devuelve exactamente este JSON: { "propuestas": [ { "cita": "...", "claves": ["...", "..."], "tema": "...", "dato": "..." } ] }',
  ]
    .filter(Boolean)
    .join("\n");

  const informe: InformeMotor = {};
  const crudo = await textoConMotor(o.motor, prompt, o.modelo, "es", "bolivia", false, informe);
  if (!crudo) throw new Error(`El motor ${informe.motor ?? o.motor} no devolvió contenido`);
  const datos = extraerJSON(crudo) as { propuestas?: unknown[] } | unknown[];
  const lista = (Array.isArray(datos) ? datos : (datos?.propuestas ?? [])) as unknown[];

  const guardadas: VistaReferencia[] = [];
  const descartadas: { cita: string; motivo: string }[] = [];
  for (const x of lista) {
    const c = PropuestaIA.safeParse(x);
    if (!c.success) continue;
    const p = leerCita(c.data.cita);
    if (!p || p.libro !== libro.numero || !pasajeValido(p)) {
      descartadas.push({ cita: c.data.cita, motivo: "no existe en la Reina-Valera 1909" });
      continue;
    }
    const faltan = clavesQueFaltan(p, c.data.claves);
    if (faltan.length) {
      descartadas.push({ cita: formatearCita(p), motivo: `el texto no dice ${faltan.map((f) => `«${f}»`).join(", ")}` });
      continue;
    }
    try {
      guardadas.push(await crearReferencia({ cita: formatearCita(p), tema: c.data.tema, dato: c.data.dato }, "IA"));
    } catch (err) {
      descartadas.push({ cita: formatearCita(p), motivo: err instanceof Error ? err.message : "no se pudo guardar" });
    }
  }
  return { guardadas, descartadas, motorUsado: informe.motor ?? o.motor, aviso: informe.aviso ?? null };
}

/** Busca una cita suelta: para enseñar el texto mientras se escribe. */
export function buscarCita(texto: string) {
  const p = leerCita(texto);
  if (!p) return null;
  const libro = libroPorNumero(p.libro);
  return { cita: formatearCita(p), libro: libro.numero, libroNombre: libro.nombre, texto: textoDelPasaje(p) };
}
