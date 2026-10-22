import { z } from "zod";
import { db } from "../db.js";
import { normalizar } from "./biblia.js";
import { ambientesDe } from "./bancoFrases.js";
import { esMotor, extraerJSON, textoConMotor, type InformeMotor } from "./guion.js";
import { CITAS_BASE } from "./pensadoresBase.js";
import { SadButTrueSchema, type SadButTrue } from "./sadButTrue.js";

/**
 * «Grandes pensadores»: el mismo formato que «Aprendiendo con la Biblia»,
 * con filósofos en vez de versículos.
 *
 *   título sobre negro («Grandes pensadores» y la semilla) · sorteo de
 *   nombres de pensadores · se para en uno · su cita sobre el vídeo, con la
 *   obra · el cierre sobre negro: lo que esa cita le dice hoy a la semilla.
 *
 * La semilla es lo que urge decir: un tema («la prisa») o una frase («no
 * tengo tiempo para nada»). Con ella se buscan citas en el banco —sin IA— o
 * se le piden a la IA, que propone una por pensador.
 *
 * Igual que en la Biblia, lo que se ve en pantalla sale del banco: la cita, el
 * autor y la obra se escriben desde la cita guardada, no desde lo que llegue
 * en el guion. Las de la base están comprobadas; las que trae la IA quedan
 * «por comprobar» hasta que alguien mire la fuente y las marque.
 */

export const TITULO_PENSADORES = "Grandes pensadores";

/** La idea de la sección, contada a la IA en cada encargo. */
export const CONTEXTO_PENSADORES = [
  "La sección «Grandes pensadores» son vídeos de diez segundos, sin voz, para TikTok y Reels en español (sobre todo Latinoamérica).",
  "Cada vídeo responde a algo que le urge a quien mira —la semilla— con lo que dijo un gran pensador de la filosofía clásica y",
  "universal: Grecia y Roma, Oriente (Confucio, Lao-Tse, Buda), la Edad Media, la modernidad y el siglo XX.",
  "Formato: un sorteo de nombres de pensadores sobre negro que se para en uno, su cita sobre un vídeo con la obra de donde sale,",
  "y un cierre sobre negro que traduce la cita a la vida de hoy, sin moralina ni frases de taza.",
  "Lo más importante: la cita tiene que ser DE ESE AUTOR y estar EN ESA OBRA. En internet circulan cientos de citas falsas",
  "(casi todo lo que se atribuye a Platón, Einstein o Buda en imágenes); esas no sirven. Mejor una cita menos famosa pero cierta.",
].join("\n");

type Fila = Awaited<ReturnType<typeof db.citaPensador.findFirstOrThrow>>;

/** La cita como la ve la pantalla. */
export function vistaCita(c: Fila) {
  return { ...c, fuenteCompleta: fuenteDe(c) };
}
export type VistaCita = ReturnType<typeof vistaCita>;

/** «Séneca, Cartas a Lucilio, carta 13, 4». */
export const fuenteDe = (c: Pick<Fila, "autor" | "obra" | "ubicacion">) =>
  [c.autor, c.obra, c.ubicacion].filter(Boolean).join(", ");

/**
 * Lo que va sobre el vídeo: el autor (lo sorteado), la cita y, en su línea,
 * la obra. Con la obra pegada al final, la raya se quedaba colgando al
 * cortarse la línea.
 */
export const fraseDeCita = (c: Pick<Fila, "autor" | "obra" | "texto">) =>
  `${c.autor}: «${c.texto.replace(/^[«"“]+|[»"”]+$/g, "").trim()}»${c.obra ? `\n— ${c.obra}` : ""}`;

let sembrado = false;

/** La base entra la primera vez (tabla vacía), comprobada. */
export async function asegurarCitasPensadores(): Promise<number> {
  if (sembrado) return 0;
  sembrado = true;
  if (await db.citaPensador.count()) return 0;
  const { count } = await db.citaPensador.createMany({
    data: CITAS_BASE.map((c) => ({ ...c, verificada: true, fuente: "MANUAL" as const })),
    skipDuplicates: true,
  });
  return count;
}

// ---------------------------------------------------------------------------
// Buscar por la semilla
// ---------------------------------------------------------------------------

const VACIAS = new Set(
  "a al algo alguien con como de del el ella ellos en es esa ese eso esta este esto la las lo los me mi mis muy nada nadie no nos o para pero por que se si sin sobre su sus te tengo ti tu tus un una uno y ya yo hay hace todo toda todos cuando donde porque mas siempre nunca cada otro otra otros demas tanto poco mucho siento estoy soy".split(
    " ",
  ),
);

/**
 * Cómo se dice en la calle lo que en el banco está como tema: «lo dejo para
 * el lunes» es postergar, «me comparo» es envidia. Sin esto, la búsqueda sin
 * IA solo encontraba la semilla escrita con las mismas palabras del tema.
 */
const EQUIVALENTES: Record<string, string[]> = {
  lunes: ["postergar", "procrastinacion", "aplazar"],
  manana: ["postergar", "aplazar"],
  despues: ["postergar", "aplazar"],
  luego: ["postergar", "aplazar"],
  dejo: ["postergar", "aplazar"],
  empezar: ["empezar", "postergar"],
  enojo: ["ira"],
  enojado: ["ira"],
  rabia: ["ira"],
  enfado: ["ira"],
  contesto: ["responder", "ira"],
  comparo: ["envidia", "deseo"],
  comparar: ["envidia", "deseo"],
  envidia: ["envidia", "deseo"],
  perdi: ["muerte", "perdida"],
  duelo: ["muerte"],
  murio: ["muerte"],
  estres: ["ansiedad", "estres"],
  nervios: ["ansiedad", "miedo"],
  temor: ["miedo"],
  celular: ["pantallas", "distraccion"],
  telefono: ["pantallas", "distraccion"],
  redes: ["redes", "pantallas"],
  chats: ["redes", "responder"],
  solo: ["soledad", "amistad"],
  sola: ["soledad", "amistad"],
  plata: ["dinero"],
  deudas: ["dinero"],
  chamba: ["trabajo", "rutina"],
  pareja: ["amor"],
  fracase: ["fracaso", "obstaculos"],
  problemas: ["problemas", "obstaculos"],
  cansado: ["sentido", "rutina"],
  cansada: ["sentido", "rutina"],
};

/**
 * Las palabras que cuentan de la semilla, recortadas a seis letras para que
 * «miedos» case con «miedo» y «postergar» con «postergación». Con cinco,
 * «contesto» casaba con «contexto».
 */
function raices(texto: string, equivalentes = false): string[] {
  const palabras = normalizar(texto)
    .split(" ")
    .filter((w) => w.length > 2 && !VACIAS.has(w));
  const todas = equivalentes ? palabras.flatMap((w) => [w, ...(EQUIVALENTES[w] ?? [])]) : palabras;
  return [...new Set(todas.map((w) => w.slice(0, 6)))];
}

/** Cuánto tiene que ver una cita con la semilla: los temas pesan el doble. */
function puntuar(c: Fila, semilla: string[]): number {
  if (!semilla.length) return 0;
  const temas = new Set(c.temas.flatMap((t) => raices(t)));
  const resto = new Set(raices(`${c.texto} ${c.contexto} ${c.remate}`));
  return semilla.reduce((n, r) => n + (temas.has(r) ? 2 : 0) + (resto.has(r) ? 1 : 0), 0);
}

export type FiltroCitas = { autor?: string; q?: string; verificada?: boolean };

export async function listarCitas(f: FiltroCitas = {}) {
  await asegurarCitasPensadores();
  const todas = await db.citaPensador.findMany({ orderBy: [{ autor: "asc" }, { creadaEn: "asc" }] });
  const semilla = f.q ? raices(f.q, true) : [];
  const citas = todas
    .filter((c) => (!f.autor || c.autor === f.autor) && (f.verificada === undefined || c.verificada === f.verificada))
    .map((c) => ({ c, p: puntuar(c, semilla) }))
    .filter((x) => !semilla.length || x.p > 0)
    .sort((a, b) => b.p - a.p)
    .map((x) => vistaCita(x.c));
  return {
    citas,
    autores: [...new Set(todas.map((c) => c.autor))].sort((a, b) => a.localeCompare(b, "es")),
    cuentas: {
      total: todas.length,
      comprobadas: todas.filter((c) => c.verificada).length,
      porComprobar: todas.filter((c) => !c.verificada).length,
      usadas: todas.filter((c) => c.usos > 0).length,
    },
  };
}

/**
 * Las que mejor responden a la semilla, de autores distintos. Entre las que
 * empatan gana la menos usada, y al final un poco de azar: la misma semilla
 * dos veces no tiene que dar el mismo vídeo.
 */
export async function buscarEnBanco(semilla: string, o: { soloComprobadas?: boolean } = {}) {
  await asegurarCitasPensadores();
  const r = raices(semilla, true);
  const todas = await db.citaPensador.findMany({ where: o.soloComprobadas ? { verificada: true } : {} });
  const puntuadas = todas
    // El azar solo desempata: nunca le gana a una palabra que casa.
    .map((c) => ({ c, base: puntuar(c, r), p: puntuar(c, r) - Math.min(c.usos, 3) * 0.3 + Math.random() * 0.25 }))
    .filter((x) => !r.length || x.base > 0)
    .sort((a, b) => b.p - a.p);
  const porAutor: Fila[] = [];
  for (const { c } of puntuadas) if (!porAutor.some((x) => x.autor === c.autor)) porAutor.push(c);
  return porAutor;
}

// ---------------------------------------------------------------------------
// El guion
// ---------------------------------------------------------------------------

export type Cierre = "aplicacion" | "otra_cita";

/** El bombo: el elegido, los que también salieron en la búsqueda y otros del banco. */
async function bombo(autor: string, cercanos: string[]): Promise<string[]> {
  const todos = (await db.citaPensador.findMany({ select: { autor: true }, distinct: ["autor"] })).map((x) => x.autor);
  const nombres: string[] = [];
  for (const a of [...cercanos, ...todos.sort(() => Math.random() - 0.5)]) {
    if (nombres.length >= 7) break;
    if (a !== autor && a.length <= 40 && !nombres.includes(a)) nombres.push(a);
  }
  return [autor, ...nombres];
}

/** «sobre la prisa», o la frase entre comillas si es una frase. */
function subtituloDe(semilla: string, c: Fila): string {
  const s = semilla.replace(/\s+/g, " ").trim();
  if (!s) return c.temas[0] ? `sobre ${c.temas[0]}` : "";
  // Un tema corto va con «sobre»; una frase, entre comillas, tal cual.
  if (s.split(" ").length <= 3) return /^sobre\b/i.test(s) ? s.toLowerCase() : `sobre ${s.toLowerCase()}`;
  return `«${s.length > 60 ? `${s.slice(0, 57)}…` : s}»`;
}

export async function guionDeCita(
  id: string,
  o: { semilla?: string; cierre?: Cierre; titulo?: string; cercanos?: string[]; remate?: string } = {},
): Promise<SadButTrue & { fuenteCompleta: string; contexto: string; verificada: boolean }> {
  const c = await db.citaPensador.findUniqueOrThrow({ where: { id } });
  let remate = (o.remate ?? c.remate).trim();
  if (o.cierre === "otra_cita") {
    // De las otras del mismo autor, la que más tenga que ver con la semilla.
    const r = raices(o.semilla ?? "", true);
    const otras = await db.citaPensador.findMany({ where: { autor: c.autor, id: { not: c.id } } });
    const otra = otras
      .map((x) => ({ x, p: puntuar(x, r) - x.usos * 0.3 + Math.random() * 0.5 }))
      .sort((a, b) => b.p - a.p)[0]?.x;
    if (otra) remate = `«${otra.texto}»${otra.obra ? ` — ${otra.obra}` : ""}`;
  }
  if (!remate) remate = "Lo dijo hace siglos, y sigue siendo para ti.";
  const delTema = ambientesDe("pensadores");
  const guion = SadButTrueSchema.parse({
    titulo: `${o.titulo || TITULO_PENSADORES} · ${c.autor}`,
    seccion: "pensadores",
    tema: o.semilla || c.temas[0] || "",
    palabras: await bombo(c.autor, o.cercanos ?? []),
    elegida: c.autor,
    frase: fraseDeCita(c),
    remate,
    tono: "reflexiva",
    keywords: [...new Set([...c.visual.slice(0, 3), ...delTema.sort(() => Math.random() - 0.5).slice(0, 2)])].slice(0, 6),
    hashtags: ["grandespensadores", "filosofia", normalizar(c.autor).replace(/\s+/g, "")],
    citaId: c.id,
    intro: { titulo: o.titulo || TITULO_PENSADORES, subtitulo: subtituloDe(o.semilla ?? "", c) },
  });
  return { ...guion, fuenteCompleta: fuenteDe(c), contexto: c.contexto, verificada: c.verificada };
}

/**
 * Antes de montar: la cita, el autor y la obra salen de la cita guardada,
 * aunque el guion traiga otra cosa escrita.
 */
export async function asegurarCitaDeGuion(g: SadButTrue) {
  if (!g.citaId) return { guion: g, fuente: null as string | null, verificada: null as boolean | null };
  const c = await db.citaPensador.findUniqueOrThrow({ where: { id: g.citaId } });
  return {
    guion: { ...g, frase: fraseDeCita(c), elegida: c.autor, palabras: g.palabras.includes(c.autor) ? g.palabras : [c.autor, ...g.palabras] },
    fuente: fuenteDe(c),
    verificada: c.verificada,
  };
}

export async function marcarCitaUsada(id: string) {
  await db.citaPensador.update({ where: { id }, data: { usos: { increment: 1 }, usadaEn: new Date() } });
}

// ---------------------------------------------------------------------------
// Crear, editar y borrar
// ---------------------------------------------------------------------------

export const CambioCita = z
  .object({
    autor: z.string().min(1).max(40),
    obra: z.string().max(120),
    ubicacion: z.string().max(60),
    texto: z.string().min(3).max(400),
    temas: z.array(z.string().min(1).max(40)).max(10),
    contexto: z.string().max(400),
    remate: z.string().max(200),
    visual: z.array(z.string().min(1).max(40)).max(6),
    verificada: z.boolean(),
  })
  .partial();
export type CambioCita = z.infer<typeof CambioCita>;

const limpio = (c: CambioCita) => ({
  ...c,
  autor: c.autor?.replace(/\s+/g, " ").trim(),
  texto: c.texto?.replace(/\s+/g, " ").trim().replace(/^[«"“]+|[»"”]+$/g, ""),
  temas: c.temas?.map((t) => t.trim().toLowerCase()).filter(Boolean),
  visual: c.visual?.map((t) => t.trim().toLowerCase()).filter(Boolean),
});

export async function crearCita(c: CambioCita & { autor: string; texto: string }, fuente: "MANUAL" | "IA" = "MANUAL") {
  const datos = limpio(c);
  const ya = await db.citaPensador.findFirst({ where: { autor: datos.autor!, texto: datos.texto! } });
  if (ya) throw new Error("Esa cita de ese autor ya está guardada.");
  return vistaCita(await db.citaPensador.create({ data: { ...datos, autor: datos.autor!, texto: datos.texto!, fuente } }));
}

export async function editarCita(id: string, c: CambioCita) {
  return vistaCita(await db.citaPensador.update({ where: { id }, data: limpio(c) }));
}

export async function borrarCita(id: string) {
  await db.citaPensador.delete({ where: { id } });
}

// ---------------------------------------------------------------------------
// Con IA
// ---------------------------------------------------------------------------

const PropuestaIA = z.object({
  autor: z.string().min(1).max(60),
  obra: z.string().max(160).default(""),
  ubicacion: z.string().max(80).default(""),
  cita: z.string().min(3).max(500),
  temas: z.array(z.string().max(40)).max(8).default([]),
  contexto: z.string().max(500).default(""),
  remate: z.string().max(300).default(""),
  visual: z.array(z.string().max(60)).max(6).default([]),
});

/**
 * Le pide a la IA pensadores para la semilla, una cita de cada uno con su
 * obra, y el cierre para hoy. Todo se guarda en el banco «por comprobar»: la
 * próxima vez esa semilla ya sale sin IA, y quien quiera publicarlas tranquilo
 * mira la fuente y las marca como comprobadas.
 */
export async function buscarConIA(o: { semilla: string; motor: string; modelo?: string | null; cuantos?: number }) {
  if (!esMotor(o.motor)) throw new Error(`Motor desconocido: ${o.motor}`);
  await asegurarCitasPensadores();
  const cuantos = Math.min(Math.max(o.cuantos ?? 8, 4), 10);
  const conocidas = await buscarEnBanco(o.semilla, { soloComprobadas: true });

  const prompt = [
    CONTEXTO_PENSADORES,
    "",
    `La semilla (lo que le urge a quien mira): «${o.semilla}».`,
    "",
    `Elige ${cuantos} pensadores DISTINTOS, de épocas y lugares variados, que hayan dicho algo que responda a esa semilla.`,
    "De cada uno:",
    "- autor: el nombre corto con el que se le conoce ('Séneca', 'Marco Aurelio', 'Simone Weil'), como mucho tres palabras.",
    "- obra: la obra exacta de donde sale la cita, en español ('Cartas a Lucilio').",
    "- ubicacion: dónde dentro de la obra, si lo sabes ('carta 13, 4', 'libro V, 20', 'aforismo 146'); si no, vacío.",
    "- cita: la cita en español, fiel a la traducción habitual, de menos de 30 palabras. SOLO si estás seguro de que es de",
    "  ese autor y de esa obra; nada de citas apócrifas ni de paráfrasis presentadas como cita.",
    "- temas: de 3 a 6 palabras sueltas de qué trata (en minúsculas).",
    "- contexto: quién era y de qué va la obra, en una línea.",
    "- remate: lo que esa cita le dice HOY a la semilla, en menos de quince palabras, sin repetir la cita y sin atribuírselo al autor.",
    "- visual: 3 búsquedas EN INGLÉS para un banco de vídeo (Pexels, Pixabay): cosas filmables que evoquen la cita",
    "  ('hourglass sand', 'empty room chair'). Nada de estatuas con texto ni de retratos del autor.",
    conocidas.length
      ? `Del banco ya hay citas comprobadas de: ${conocidas
          .slice(0, 6)
          .map((c) => c.autor)
          .join(", ")}. Puedes usar otros autores para variar.`
      : "",
    "",
    'Devuelve exactamente este JSON: { "pensadores": [ { "autor": "...", "obra": "...", "ubicacion": "...", "cita": "...", "temas": ["..."], "contexto": "...", "remate": "...", "visual": ["...", "...", "..."] } ], "elegido": "el autor que mejor responde a la semilla" }',
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");

  const informe: InformeMotor = {};
  const crudo = await textoConMotor(o.motor, prompt, o.modelo, "es", "bolivia", false, informe);
  if (!crudo) throw new Error(`El motor ${informe.motor ?? o.motor} no devolvió contenido`);
  const datos = extraerJSON(crudo) as { pensadores?: unknown[]; elegido?: string } | unknown[];
  const lista = (Array.isArray(datos) ? datos : (datos?.pensadores ?? [])) as unknown[];
  const elegido = Array.isArray(datos) ? "" : String(datos?.elegido ?? "");

  const guardadas: { cita: Fila; remate: string }[] = [];
  for (const x of lista) {
    const p = PropuestaIA.safeParse(x);
    if (!p.success) continue;
    const d = p.data;
    const autor = d.autor.replace(/\s+/g, " ").trim().slice(0, 40);
    const texto = d.cita.replace(/\s+/g, " ").trim().replace(/^[«"“]+|[»"”]+$/g, "");
    if (guardadas.some((g) => g.cita.autor === autor)) continue;
    const ya = await db.citaPensador.findFirst({ where: { autor, texto } });
    const cita =
      ya ??
      (await db.citaPensador.create({
        data: {
          autor,
          texto,
          obra: d.obra.trim(),
          ubicacion: d.ubicacion.trim(),
          temas: d.temas.map((t) => t.trim().toLowerCase()).filter(Boolean),
          contexto: d.contexto.trim(),
          remate: d.remate.trim(),
          visual: d.visual.map((v) => v.trim().toLowerCase()).filter((v) => v && v.length <= 40).slice(0, 4),
          verificada: false,
          fuente: "IA",
        },
      }));
    guardadas.push({ cita, remate: d.remate.trim() || cita.remate });
  }
  if (!guardadas.length) throw new Error("La IA no devolvió ninguna cita que se pueda usar. Prueba otra vez u otro motor.");
  const ganadora =
    guardadas.find((g) => normalizar(g.cita.autor) === normalizar(elegido)) ?? guardadas[0];
  return { guardadas, ganadora, motorUsado: informe.motor ?? o.motor, aviso: informe.aviso ?? null };
}
