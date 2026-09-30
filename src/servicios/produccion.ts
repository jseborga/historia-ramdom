import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import { buscarPreset } from "../render/presets.js";
import { ESTILO_POR_DEFECTO } from "../render/rotulos.js";
import { esMotor, extraerJSON, textoConMotor, type InformeMotor } from "./guion.js";
import { clipDeMedio } from "./medios.js";
import { ClipPistaSchema, ProyectoSchema, PublicacionSchema, RotuloPistaSchema, type ClipPista, type RotuloPista } from "./proyecto.js";

/**
 * Producciones con IA de vídeo: el tráiler de una obra que no existe.
 *
 * El vídeo no se genera aquí. Veo lo genera fuera —en Gemini o en Flow, con la
 * suscripción de quien lo usa— y aquí se prepara todo para que salga
 * **consistente** y se monta lo que vuelve:
 *
 *   - la biblia: título, logline y un bloque de estilo visual que va igual en
 *     todos los prompts;
 *   - los personajes, con una ficha visual fija que se pega literal en cada
 *     prompt (si se reescribe con otras palabras, el personaje cambia de cara)
 *     y el prompt para su imagen de referencia;
 *   - los planos, cada uno con su prompt de Veo armado siempre igual, y su
 *     estado a lo largo de los días que tarde en generarse todo.
 *
 * Los prompts se arman aquí y no los escribe la IA plano a plano: el mismo
 * orden, las mismas fichas y las mismas coletillas en todos, que es lo único
 * que mantiene la consistencia entre generaciones.
 */

/** Lo que dura un plano en Veo 3.1: 4, 6 u 8 s, y 8 si lleva referencias. */
export const DURACIONES = [4, 6, 8] as const;
/** Imágenes de referencia que admite Veo por generación. */
export const MAX_REFERENCIAS = 3;
/** Palabras que caben habladas con naturalidad en un plano de 8 s. */
export const PALABRAS_POR_PLANO = 15;

/** Las partes de un tráiler, en el orden en que se cuentan. */
export const PARTES = ["gancho", "mundo", "personaje", "conflicto", "escalada", "silencio", "titulo", "proximamente"] as const;
export type Parte = (typeof PARTES)[number];

export const NOMBRES_PARTE: Record<Parte, string> = {
  gancho: "Gancho en frío",
  mundo: "El mundo",
  personaje: "Personaje",
  conflicto: "Conflicto",
  escalada: "Escalada",
  silencio: "Silencio",
  titulo: "Título",
  proximamente: "Próximamente",
};

export const OBRAS = ["pelicula", "serie", "anime", "documental", "videojuego"] as const;
export type Obra = (typeof OBRAS)[number];

const OBRA_EN: Record<Obra, string> = {
  pelicula: "feature film",
  serie: "TV series",
  anime: "anime series",
  documental: "documentary",
  videojuego: "video game",
};

/** Cuántos planos generados por duración de tráiler, sin contar los cartones. */
const PLANOS_POR_DURACION: Record<number, [number, number]> = { 30: [4, 5], 60: [7, 8], 90: [10, 11] };

// ---------------------------------------------------------------------------
// Lo que devuelve la IA
// ---------------------------------------------------------------------------

const PersonajeIA = z.object({
  nombre: z.string().min(1).max(40),
  papel: z.string().max(200).default(""),
  ficha: z.string().min(1).max(600),
  voz: z.string().max(300).default(""),
});

const PlanoIA = z.object({
  parte: z.enum(PARTES).catch("escalada"),
  tipo: z.enum(["veo", "carton"]).catch("veo"),
  duracion: z.number().int().catch(8),
  accion: z.string().max(800).default(""),
  camara: z.string().max(300).default(""),
  sonido: z.string().max(300).default(""),
  personajes: z.array(z.string().max(40)).default([]),
  dialogo: z
    .array(z.object({ personaje: z.string().max(40), texto: z.string().max(300) }))
    .default([]),
  rotulo: z.string().max(80).default(""),
});

export const TrailerIASchema = z.object({
  titulo: z.string().min(1).max(120),
  logline: z.string().max(400).default(""),
  genero: z.string().max(80).default(""),
  estilo: z.string().max(800).default(""),
  pitch: z
    .object({
      sinopsis: z.string().max(1200).default(""),
      publico: z.string().max(400).default(""),
      formato: z.string().max(300).default(""),
      referencias: z.array(z.string().max(120)).max(5).default([]),
      porQueAhora: z.string().max(400).default(""),
    })
    .default({}),
  personajes: z.array(PersonajeIA).min(1).max(6),
  planos: z.array(PlanoIA).min(3).max(16),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
});
export type TrailerIA = z.infer<typeof TrailerIASchema>;

const pelar = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Deja lo de la IA en algo que se pueda producir de verdad con Veo:
 *
 *   - nunca más de tres personajes por plano, que son las referencias que
 *     admite Veo;
 *   - si sale un personaje, el plano dura 8 s: con referencias, Veo no genera
 *     otra cosa;
 *   - como mucho dos frases por plano, y cada una de alguien que exista;
 *   - el tráiler termina con el título y con "Próximamente", que son
 *     cartones y los pone la app, no Veo.
 */
export function repararTrailer(d: TrailerIA): TrailerIA {
  const nombres = new Map(d.personajes.map((p) => [pelar(p.nombre), p.nombre]));
  const deVerdad = (n: string) => nombres.get(pelar(n));

  type PlanoReparado = TrailerIA["planos"][number];
  const planos: PlanoReparado[] = d.planos.map((p): PlanoReparado => {
    const esCarton = p.tipo === "carton" || p.parte === "titulo" || p.parte === "proximamente";
    if (esCarton) {
      return { ...p, tipo: "carton", personajes: [], dialogo: [], duracion: p.parte === "titulo" ? 3 : 2 };
    }
    const personajes = [...new Set(p.personajes.map(deVerdad).filter((x): x is string => Boolean(x)))].slice(
      0,
      MAX_REFERENCIAS,
    );
    const dialogo = p.dialogo
      .map((x) => ({ personaje: deVerdad(x.personaje) ?? "", texto: x.texto.trim() }))
      .filter((x) => x.personaje && x.texto)
      .slice(0, 2);
    // Quien habla tiene que salir en el plano.
    for (const x of dialogo) if (!personajes.includes(x.personaje) && personajes.length < MAX_REFERENCIAS) personajes.push(x.personaje);
    const duracion = personajes.length ? 8 : (DURACIONES as readonly number[]).includes(p.duracion) ? p.duracion : 8;
    return { ...p, tipo: "veo", personajes, dialogo, duracion };
  });

  // Un tráiler sin título ni cierre no es un tráiler: si faltan, se ponen.
  if (!planos.some((p) => p.parte === "titulo")) {
    planos.push({ ...PlanoIA.parse({}), parte: "titulo", tipo: "carton", duracion: 3, rotulo: d.titulo });
  }
  if (!planos.some((p) => p.parte === "proximamente")) {
    planos.push({ ...PlanoIA.parse({}), parte: "proximamente", tipo: "carton", duracion: 2, rotulo: "Próximamente" });
  }
  for (const p of planos) {
    if (p.parte === "titulo" && !p.rotulo) p.rotulo = d.titulo;
    if (p.parte === "proximamente" && !p.rotulo) p.rotulo = "Próximamente";
  }
  // Los cartones, al final y en su orden: título y después el cierre.
  const veo = planos.filter((p) => p.tipo === "veo");
  const titulo = planos.filter((p) => p.parte === "titulo").slice(0, 1);
  const cierre = planos.filter((p) => p.parte === "proximamente").slice(0, 1);
  return { ...d, planos: [...veo, ...titulo, ...cierre] };
}

export type PeticionTrailer = {
  idea: string;
  obra: Obra;
  genero?: string;
  /** 30, 60 o 90 s. */
  duracion: number;
  formato: string;
  idioma: string;
  motor: string;
  modelo?: string | null;
};

const IDIOMA_DIALOGO: Record<string, string> = {
  es: "español",
  en: "inglés",
  spanglish: "español con alguna palabra en inglés, como se habla en Miami",
};

/**
 * El encargo a la IA. Lo que decide si luego se puede producir está repetido
 * a propósito: los límites de Veo (tres referencias, 8 s, quince palabras) y
 * que las fichas sean solo lo que se ve, en inglés y sin nombres propios de
 * nadie real.
 */
export async function generarTrailer(p: PeticionTrailer): Promise<{ trailer: TrailerIA; informe: InformeMotor }> {
  if (!esMotor(p.motor)) throw new Error(`Motor desconocido: ${p.motor}`);
  const [min, max] = PLANOS_POR_DURACION[p.duracion] ?? PLANOS_POR_DURACION[60];
  const vertical = buscarPreset(p.formato).alto > buscarPreset(p.formato).ancho;

  const prompt = [
    `Diseña el tráiler de ${p.duracion} segundos de un(a) ${p.obra} que no existe, para venderlo como idea de producción.`,
    `La idea: ${p.idea}`,
    p.genero ? `Género: ${p.genero}.` : "",
    `Formato: ${vertical ? "vertical 9:16" : "horizontal 16:9"}.`,
    "",
    "Cada plano se va a generar con Veo 3.1, que tiene estos límites. Respétalos o el plano no se podrá hacer:",
    `- Un plano dura 4, 6 u 8 segundos. Si sale un personaje, dura 8.`,
    `- Como mucho ${MAX_REFERENCIAS} personajes por plano.`,
    `- Como mucho ${PALABRAS_POR_PLANO} palabras de diálogo por plano, y dos frases.`,
    "- Todos los personajes son adultos.",
    "",
    "Estructura del tráiler, en este orden:",
    "1. gancho: un plano que engancha sin explicar nada.",
    "2. mundo: uno o dos planos que enseñan dónde pasa.",
    "3. personaje: un plano por cada protagonista, con su nombre en 'rotulo'.",
    "4. conflicto: lo que se rompe.",
    "5. escalada: planos cortos (4 o 6 s, sin personajes si puede ser) que suben de ritmo.",
    "6. silencio: un plano quieto con una sola frase que se queda.",
    "7. titulo y 8. proximamente: son cartones de texto (tipo 'carton'), no se generan.",
    `En total, entre ${min} y ${max} planos 'veo' más los dos cartones.`,
    "",
    "Reglas:",
    "- Personajes, mundo y título ORIGINALES: nada de personajes, actores, marcas ni franquicias que existan.",
    "- 'ficha' es solo lo que se VE, en inglés: edad aparente, cara, pelo, complexión y una ropa que no cambia en todo el tráiler. Sin su nombre dentro. De 25 a 45 palabras, concreta (no 'guapo': 'mandíbula marcada, nariz rota').",
    "- 'voz' es cómo suena, en inglés: edad, timbre, ritmo y acento.",
    "- 'estilo' es el aspecto de TODA la obra, en inglés: época, cámara y óptica, luz, paleta y textura. Va igual en todos los planos.",
    "- 'accion', 'camara' y 'sonido' en inglés, concretos y filmables en un plano: nada de 'y luego'.",
    `- El diálogo, en ${IDIOMA_DIALOGO[p.idioma] ?? "español"}.`,
    "- El sonido es ambiente y efectos, nunca música: la música del tráiler la pone el montaje.",
    "- 'pitch' vende la idea: sinopsis de la obra entera (no del tráiler), público, formato (duración, episodios), 2 o 3 obras de referencia de tono ('como X por su atmósfera') y por qué ahora.",
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "titulo": "…", "logline": "una frase", "genero": "…",',
    '  "estilo": "visual style block in English",',
    '  "pitch": { "sinopsis": "…", "publico": "…", "formato": "…", "referencias": ["…"], "porQueAhora": "…" },',
    '  "personajes": [ { "nombre": "…", "papel": "quién es en la historia", "ficha": "visual description in English", "voz": "voice in English" } ],',
    '  "planos": [ { "parte": "gancho", "tipo": "veo", "duracion": 8, "accion": "…", "camara": "…", "sonido": "…",',
    '                "personajes": ["Nombre"], "dialogo": [ { "personaje": "Nombre", "texto": "…" } ], "rotulo": "" } ],',
    '  "hashtags": ["sinAlmohadilla"]',
    "}",
  ]
    .filter(Boolean)
    .join("\n");

  const informe: InformeMotor = {};
  const crudo = await textoConMotor(p.motor, prompt, p.modelo, p.idioma, "latam", false, informe);
  if (!crudo) throw new Error(`El motor ${informe.motor ?? p.motor} no devolvió contenido`);
  const trailer = repararTrailer(TrailerIASchema.parse(extraerJSON(crudo)));
  return { trailer, informe };
}

/** Guarda lo generado como una producción nueva, con sus personajes y planos. */
export async function crearProduccion(p: PeticionTrailer, t: TrailerIA) {
  return db.$transaction(async (tx) => {
    const pr = await tx.produccion.create({
      data: {
        tipo: "TRAILER",
        obra: p.obra,
        idea: p.idea,
        titulo: t.titulo,
        logline: t.logline,
        genero: t.genero || p.genero || "",
        formato: buscarPreset(p.formato).id,
        estilo: t.estilo,
        idioma: p.idioma,
        pitch: t.pitch,
        hashtags: t.hashtags,
      },
    });
    const ids = new Map<string, string>();
    for (const [i, x] of t.personajes.entries()) {
      const pj = await tx.personaje.create({
        data: { produccionId: pr.id, orden: i, nombre: x.nombre, papel: x.papel, ficha: x.ficha, voz: x.voz },
      });
      ids.set(x.nombre, pj.id);
    }
    for (const [i, x] of t.planos.entries()) {
      await tx.plano.create({
        data: {
          produccionId: pr.id,
          orden: i,
          tipo: x.tipo,
          parte: x.parte,
          duracion: x.duracion,
          accion: x.accion,
          camara: x.camara,
          sonido: x.sonido,
          personajes: x.personajes.map((n) => ids.get(n)).filter((v): v is string => Boolean(v)),
          dialogo: x.dialogo.map((d) => ({ personajeId: ids.get(d.personaje) ?? "", texto: d.texto })),
          rotulo: x.rotulo,
        },
      });
    }
    return pr;
  });
}

// ---------------------------------------------------------------------------
// Los prompts: armados aquí, siempre igual
// ---------------------------------------------------------------------------

type PersonajeFila = { id: string; nombre: string; ficha: string; voz: string };
type PlanoFila = {
  tipo: string;
  accion: string;
  camara: string;
  sonido: string;
  personajes: string[];
  dialogo: unknown;
  continua: boolean;
};
type ProduccionFila = { obra: string; genero: string; estilo: string; formato: string; idioma: string };

export type Linea = { personajeId: string; texto: string };
export const lineasDe = (v: unknown): Linea[] =>
  (Array.isArray(v) ? v : [])
    .map((x) => (x && typeof x === "object" ? (x as Record<string, unknown>) : {}))
    .map((x) => ({ personajeId: String(x.personajeId ?? ""), texto: String(x.texto ?? "") }))
    .filter((x) => x.texto.trim());

/** Con su punto al final: los bloques se pegan uno detrás de otro. */
const conPunto = (v: string) => (/[.!?]$/.test(v.trim()) ? v.trim() : `${v.trim()}.`);

const HABLA_EN: Record<string, string> = { es: "in Spanish", en: "in English", spanglish: "in Spanish mixed with some English" };

/**
 * El prompt de Veo de un plano. Siempre en el mismo orden —estilo, formato,
 * personajes con su ficha, cámara, acción, diálogo, sonido, coletillas— y con
 * la ficha de cada personaje palabra por palabra, que es lo que lo hace
 * reconocible de un plano a otro junto con su imagen de referencia.
 *
 * Termina pidiendo que no haya música ni texto en pantalla: la música la pone
 * el montaje, una sola para todo el tráiler (la de cada plano no casaría con
 * la del siguiente), y un subtítulo quemado por Veo no se puede quitar.
 */
export function promptVeo(pr: ProduccionFila, plano: PlanoFila, todos: PersonajeFila[]): string {
  if (plano.tipo === "carton") return "";
  const preset = buscarPreset(pr.formato);
  const vertical = preset.alto > preset.ancho;
  const presentes = plano.personajes
    .map((id) => todos.find((p) => p.id === id))
    .filter((p): p is PersonajeFila => Boolean(p));
  const nombre = (id: string) => todos.find((p) => p.id === id)?.nombre.toUpperCase() ?? "SOMEONE";

  const lineas: string[] = [];
  if (pr.estilo.trim()) lineas.push(`Style: ${conPunto(pr.estilo)}`);
  lineas.push(vertical ? "Vertical 9:16 frame." : "Horizontal 16:9 frame.");
  if (presentes.length) {
    lineas.push("Characters (keep them exactly as in the reference images):");
    for (const p of presentes) {
      lineas.push(`- ${p.nombre.toUpperCase()}: ${conPunto(p.ficha)}${p.voz.trim() ? ` Voice: ${conPunto(p.voz)}` : ""}`);
    }
  }
  if (plano.continua) {
    lineas.push("This shot continues directly from the previous one: start from the provided first frame, same light and positions.");
  }
  if (plano.camara.trim()) lineas.push(`Camera: ${conPunto(plano.camara)}`);
  if (plano.accion.trim()) lineas.push(conPunto(plano.accion));
  const habla = HABLA_EN[pr.idioma] ?? "in Spanish";
  for (const l of lineasDe(plano.dialogo)) {
    lineas.push(`${nombre(l.personajeId)} says ${habla}: "${l.texto.trim().replace(/"/g, "'")}"`);
  }
  if (plano.sonido.trim()) lineas.push(`Sound: ${conPunto(plano.sonido)}`);
  lineas.push("No background music. No subtitles, no captions, no on-screen text, no watermark.");
  return lineas.join("\n");
}

/**
 * El prompt de la imagen de referencia de un personaje: una hoja de personaje
 * (de frente, tres cuartos y perfil) sobre fondo neutro. Es la imagen que
 * mejor funciona como referencia en Veo: se le ve entero y desde varios
 * lados, sin un fondo que se cuele en los planos.
 */
export function promptImagen(pr: ProduccionFila, pj: PersonajeFila): string {
  const obra = OBRA_EN[pr.obra as Obra] ?? "feature film";
  const animado = pr.obra === "anime";
  return [
    `${animado ? "Anime-style character" : "Character"} reference sheet for an original ${obra}${pr.genero ? ` (${pr.genero})` : ""}.`,
    conPunto(pj.ficha),
    "The same person shown three times side by side: front view, three-quarter view and profile, full body, plus a close-up of the face.",
    "Neutral light grey background, soft even studio light, sharp focus, consistent proportions.",
    pr.estilo.trim() ? `Visual style of the production: ${conPunto(pr.estilo)}` : "",
    "No text, no labels, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

// ---------------------------------------------------------------------------
// El montaje: de los planos subidos a un proyecto del editor
// ---------------------------------------------------------------------------

export type QueMontar = "trailer" | "avance" | "personaje";

const ESTILO_TITULO = { ...ESTILO_POR_DEFECTO, tamano: 96, color: "#FFFFFF", contorno: "#FFFFFF", borde: 1, posicion: "centro" as const, negrita: true, sombra: 3 };
const ESTILO_CARTON = { ...ESTILO_POR_DEFECTO, tamano: 60, color: "#D8D8D8", contorno: "#D8D8D8", borde: 1, posicion: "centro" as const, sombra: 2 };
const ESTILO_NOMBRE = { ...ESTILO_POR_DEFECTO, tamano: 58, color: "#FFFFFF", contorno: "#000000", borde: 3, posicion: "abajo" as const, negrita: true, sombra: 4 };
const ESTILO_PENDIENTE = { ...ESTILO_POR_DEFECTO, tamano: 44, color: "#8A8F98", contorno: "#8A8F98", borde: 1, posicion: "centro" as const };

/**
 * Monta en un proyecto del editor lo que haya de la producción:
 *
 *   - **tráiler**: solo los planos aprobados y marcados para el tráiler, más
 *     los cartones. Es lo que se enseña.
 *   - **avance**: todo lo que tenga vídeo, aprobado o no, y un cartón gris en
 *     el sitio de cada plano que falta. Es para ver cómo va, días antes de
 *     tenerlo todo.
 *   - **personaje**: los planos donde sale uno, con su nombre delante: un
 *     teaser de ese personaje.
 *
 * El sonido de cada plano se conserva —es el diálogo que habló Veo, con los
 * labios ya sincronizados— y la música, si se elige, es una sola para todo y
 * se aparta cuando alguien habla.
 */
export async function montarProduccion(
  produccionId: string,
  o: { que: QueMontar; personajeId?: string; musica?: string | null; volumenMusica?: number },
) {
  const pr = await db.produccion.findUniqueOrThrow({
    where: { id: produccionId },
    include: { planos: { orderBy: { orden: "asc" } }, personajes: { orderBy: { orden: "asc" } } },
  });
  const medios = await db.medio.findMany({
    where: { id: { in: pr.planos.map((p) => p.medioId).filter((v): v is string => Boolean(v)) } },
  });
  const medioDe = new Map(medios.map((m) => [m.id, m]));
  const protagonista = o.personajeId ? pr.personajes.find((p) => p.id === o.personajeId) : undefined;
  if (o.que === "personaje" && !protagonista) throw new Error("Ese personaje no es de esta producción");

  const video: ClipPista[] = [];
  const textos: RotuloPista[] = [];
  let t = 0;
  const carton = (texto: string, duracion: number, estilo: Record<string, unknown>) => {
    video.push(ClipPistaSchema.parse({ id: randomUUID(), clip: null, color: "#000000", duracion }));
    if (texto.trim()) {
      textos.push(
        RotuloPistaSchema.parse({ id: randomUUID(), inicio: t, duracion, texto, estilo, animacion: "suave", lectura: "todo" }),
      );
    }
    t += duracion;
  };

  if (protagonista) carton(protagonista.nombre.toUpperCase(), 2, ESTILO_TITULO);

  let usados = 0;
  for (const [i, p] of pr.planos.entries()) {
    if (p.tipo === "carton") {
      carton(p.rotulo || (p.parte === "titulo" ? pr.titulo : ""), p.duracion, p.parte === "titulo" ? ESTILO_TITULO : ESTILO_CARTON);
      continue;
    }
    const m = p.medioId ? medioDe.get(p.medioId) : undefined;
    const vale =
      o.que === "trailer"
        ? p.estado === "APROBADO" && p.momentoTrailer
        : o.que === "personaje"
          ? Boolean(m) && p.personajes.includes(protagonista!.id)
          : Boolean(m) && p.estado !== "REGENERAR";
    if (!vale || !m) {
      // En el avance, el hueco se ve: así se sabe cuánto falta y dónde.
      if (o.que === "avance") carton(`Plano ${i + 1} · ${p.parte || "pendiente"} · en producción`, 1.5, ESTILO_PENDIENTE);
      continue;
    }
    const duracion = Math.max(0.5, Math.min(m.duracion ?? p.duracion, 60));
    video.push(
      ClipPistaSchema.parse({
        id: randomUUID(),
        clip: clipDeMedio(m),
        duracion,
        // Una foto subida como plano no tiene sonido que conservar.
        audio: m.clase === "VIDEO",
        encuadre: "recortar",
      }),
    );
    if (p.rotulo.trim()) {
      textos.push(
        RotuloPistaSchema.parse({
          id: randomUUID(),
          inicio: t + 0.4,
          duracion: Math.min(2.6, duracion - 0.4),
          texto: p.rotulo.toUpperCase(),
          estilo: ESTILO_NOMBRE,
          animacion: "fundido",
          lectura: "todo",
        }),
      );
    }
    t += duracion;
    usados++;
  }
  if (!usados) {
    throw new Error(
      o.que === "trailer"
        ? "Todavía no hay planos aprobados para el tráiler. Sube y aprueba alguno, o monta un avance."
        : "Todavía no hay ningún plano con vídeo.",
    );
  }

  const nombre =
    o.que === "trailer"
      ? `${pr.titulo} · tráiler`
      : o.que === "avance"
        ? `${pr.titulo} · avance ${new Date().toLocaleDateString("es")}`
        : `${pr.titulo} · ${protagonista!.nombre}`;
  const datos = ProyectoSchema.parse({
    nombre: nombre.slice(0, 120),
    formato: buscarPreset(pr.formato).id,
    video,
    textos,
    voz: { modo: "ninguna", idioma: pr.idioma === "en" ? "en" : "es" },
    musica: o.musica ? { archivo: o.musica, subida: false, volumen: o.volumenMusica ?? 0.35 } : {},
  });
  return db.proyecto.create({
    data: {
      nombre: datos.nombre,
      formato: datos.formato,
      escenas: datos.video,
      textos: datos.textos,
      voz: datos.voz,
      musica: datos.musica,
      publicacion: PublicacionSchema.parse({
        gancho: pr.logline.slice(0, 200),
        hashtags: pr.hashtags.slice(0, 8),
      }),
    },
  });
}
