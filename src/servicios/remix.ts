import { z } from "zod";
import { VOCABULARIO, etiquetaCanonica, revisarEtiquetas } from "./etiquetasSuno.js";
import {
  extraerJSON,
  textoConMotor,
  esMotor,
  motorDisponible,
  ORTOGRAFIA,
  type InformeMotor,
  type Motor,
} from "./guion.js";

/**
 * Remix de una canción: la misma idea contada en otros ritmos, con todo lo
 * que hace falta para pedírsela a Suno.
 *
 * Dos caminos, y la diferencia no es un detalle:
 *
 *  - **Letra propia**: se puede reescribir, recortar y adaptar a cada ritmo.
 *    Es tuya.
 *  - **Letra ajena**: reescribir la letra de otro es hacer una obra derivada,
 *    y eso necesita permiso del autor. Aquí NO se hace: de la canción ajena se
 *    toma solo el tema y la emoción, y se escribe una canción **original**.
 *    Además se comprueba la salida: si alguna frase del original se coló tal
 *    cual, se avisa por su nombre para corregirla antes de publicar nada.
 */

/**
 * Ritmos que Suno entiende bien, con su descriptor, su tempo habitual y la
 * familia con la que se agrupan en pantalla (sesenta botones sueltos no los
 * mira nadie).
 */
export const RITMOS = [
  // ---- Latino ----
  { id: "cumbia", nombre: "Cumbia", familia: "Latino", estilo: "cumbia, accordion, güira, warm bass, danceable", bpm: "95-105" },
  { id: "cumbia_villera", nombre: "Cumbia villera", familia: "Latino", estilo: "cumbia villera, raw synths, street attitude", bpm: "95-105" },
  { id: "salsa", nombre: "Salsa", familia: "Latino", estilo: "salsa dura, piano montuno, brass section, timbales", bpm: "180-200" },
  { id: "bachata", nombre: "Bachata", familia: "Latino", estilo: "bachata, requinto guitar, bongo, romantic vocals", bpm: "120-130" },
  { id: "merengue", nombre: "Merengue", familia: "Latino", estilo: "merengue, tambora, güira, brass, party energy", bpm: "130-150" },
  { id: "vallenato", nombre: "Vallenato", familia: "Latino", estilo: "vallenato, accordion, caja vallenata, storytelling", bpm: "95-110" },
  { id: "ranchera", nombre: "Ranchera / Banda", familia: "Latino", estilo: "ranchera banda, mariachi brass, powerful vocals", bpm: "80-100" },
  { id: "corrido", nombre: "Corrido tumbado", familia: "Latino", estilo: "corrido tumbado, requinto, tuba, raspy vocals", bpm: "75-95" },
  { id: "bolero", nombre: "Bolero", familia: "Latino", estilo: "bolero, nylon guitar, strings, intimate crooning", bpm: "60-75" },
  { id: "tango", nombre: "Tango", familia: "Latino", estilo: "tango, bandoneon, strings, dramatic phrasing", bpm: "60-80" },
  { id: "flamenco", nombre: "Flamenco", familia: "Latino", estilo: "flamenco, spanish guitar, palmas, cante jondo", bpm: "90-120" },

  // ---- Andino ----
  { id: "huayno", nombre: "Huayño", familia: "Andino", estilo: "huayno andino, quena, charango, zampoña, andean vocals", bpm: "100-120" },
  { id: "saya", nombre: "Saya / Caporal", familia: "Andino", estilo: "saya caporal, afro-bolivian drums, bombo, brass, festive", bpm: "100-115" },
  { id: "morenada", nombre: "Morenada", familia: "Andino", estilo: "morenada, matraca, heavy brass band, andean folk", bpm: "80-95" },
  { id: "cueca", nombre: "Cueca", familia: "Andino", estilo: "cueca boliviana, guitar, charango, melancholic waltz feel", bpm: "90-105" },
  { id: "tinku", nombre: "Tinku", familia: "Andino", estilo: "tinku andino, bombo, charango, driving ritual rhythm", bpm: "110-125" },

  // ---- Urbano ----
  { id: "reggaeton", nombre: "Reggaetón", familia: "Urbano", estilo: "reggaeton, dembow beat, deep 808, catchy hook", bpm: "88-96" },
  { id: "dembow", nombre: "Dembow", familia: "Urbano", estilo: "dominican dembow, fast percussion, chant vocals", bpm: "115-125" },
  { id: "trap", nombre: "Trap latino", familia: "Urbano", estilo: "latin trap, dark 808s, hi-hat rolls, autotune", bpm: "70-85" },
  { id: "drill", nombre: "Drill", familia: "Urbano", estilo: "drill, sliding 808s, menacing piano, hard flow", bpm: "138-145" },
  { id: "rnb", nombre: "R&B", familia: "Urbano", estilo: "r&b, silky vocals, rhodes, laid-back groove", bpm: "70-90" },
  { id: "afrobeats", nombre: "Afrobeats", familia: "Urbano", estilo: "afrobeats, log drum, airy synths, smooth vocals", bpm: "100-115" },

  // ---- Rock ----
  { id: "rock", nombre: "Rock", familia: "Rock", estilo: "rock, distorted guitars, live drums, anthemic chorus", bpm: "120-140" },
  { id: "rocknroll", nombre: "Rock and roll (50s)", familia: "Rock", estilo: "1950s rock and roll, boogie piano, slapback echo, sax solo", bpm: "150-175" },
  { id: "rockabilly", nombre: "Rockabilly", familia: "Rock", estilo: "rockabilly, upright slap bass, twangy guitar, hiccup vocals", bpm: "160-185" },
  { id: "surf", nombre: "Surf rock", familia: "Rock", estilo: "surf rock, reverb-drenched guitar, tremolo picking, tom beat", bpm: "150-170" },
  { id: "garage", nombre: "Garage rock", familia: "Rock", estilo: "garage rock, fuzzy guitars, raw room drums, shouted vocals", bpm: "130-160" },
  { id: "hard_rock", nombre: "Hard rock", familia: "Rock", estilo: "hard rock, riff-driven guitars, wailing vocals, big drums", bpm: "115-140" },
  { id: "glam", nombre: "Glam rock", familia: "Rock", estilo: "glam rock, stomping beat, layered guitars, sing-along chorus", bpm: "120-140" },
  { id: "punk_rock", nombre: "Punk rock (77)", familia: "Rock", estilo: "77 punk rock, buzzsaw guitars, snotty vocals, no solos", bpm: "160-190" },
  { id: "punk", nombre: "Pop punk", familia: "Rock", estilo: "pop punk, fast power chords, shouted gang vocals", bpm: "150-175" },
  { id: "post_punk", nombre: "Post-punk", familia: "Rock", estilo: "post-punk, cold bassline, chorused guitar, detached vocals", bpm: "130-150" },
  { id: "grunge", nombre: "Grunge", familia: "Rock", estilo: "grunge, quiet-loud dynamics, sludgy guitars, weary vocals", bpm: "95-125" },
  { id: "indie", nombre: "Indie rock", familia: "Rock", estilo: "indie rock, jangly guitars, warm lo-fi mix, earnest vocals", bpm: "110-135" },
  { id: "rock_progresivo", nombre: "Rock progresivo", familia: "Rock", estilo: "progressive rock, odd time signatures, organ, long build", bpm: "90-140" },
  { id: "psicodelico", nombre: "Psicodélico", familia: "Rock", estilo: "psychedelic rock, phaser, sitar-like leads, hazy vocals", bpm: "100-125" },
  { id: "stoner", nombre: "Stoner rock", familia: "Rock", estilo: "stoner rock, fuzz bass, downtuned riffs, desert groove", bpm: "90-120" },
  { id: "rock_latino", nombre: "Rock en español", familia: "Rock", estilo: "latin alternative rock, spanish vocals, ska-tinged guitars", bpm: "120-150" },
  { id: "post_rock", nombre: "Post-rock", familia: "Rock", estilo: "post-rock, clean delayed guitars, slow build, cathartic climax", bpm: "80-120" },
  { id: "shoegaze", nombre: "Shoegaze", familia: "Rock", estilo: "shoegaze, walls of reverbed guitar, buried vocals, dreamy haze", bpm: "100-130" },

  // ---- Metal ----
  { id: "metal", nombre: "Metal", familia: "Metal", estilo: "metal, double kick, heavy riffs, aggressive vocals", bpm: "140-170" },
  { id: "heavy_metal", nombre: "Heavy metal (NWOBHM)", familia: "Metal", estilo: "classic heavy metal, galloping riffs, twin guitar harmonies, soaring vocals", bpm: "140-170" },
  { id: "thrash", nombre: "Thrash metal", familia: "Metal", estilo: "thrash metal, palm-muted riffing, blistering solos, shouted vocals", bpm: "180-220" },
  { id: "death_metal", nombre: "Death metal", familia: "Metal", estilo: "death metal, tremolo riffs, blast beats, guttural growls", bpm: "180-240" },
  { id: "black_metal", nombre: "Black metal", familia: "Metal", estilo: "black metal, raw tremolo guitars, blast beats, shrieked vocals", bpm: "180-220" },
  { id: "doom", nombre: "Doom metal", familia: "Metal", estilo: "doom metal, glacial tempo, massive fuzz riffs, mournful vocals", bpm: "60-80" },
  { id: "power_metal", nombre: "Power metal", familia: "Metal", estilo: "power metal, galloping double kick, keyboards, epic clean vocals", bpm: "160-190" },
  { id: "metal_sinfonico", nombre: "Metal sinfónico", familia: "Metal", estilo: "symphonic metal, orchestra, choir, operatic female vocals", bpm: "120-160" },
  { id: "folk_metal", nombre: "Folk metal", familia: "Metal", estilo: "folk metal, fiddle and flute over heavy riffs, tavern chorus", bpm: "140-170" },
  { id: "metal_progresivo", nombre: "Metal progresivo", familia: "Metal", estilo: "progressive metal, odd meters, technical riffs, dynamic clean vocals", bpm: "120-170" },
  { id: "metalcore", nombre: "Metalcore", familia: "Metal", estilo: "metalcore, breakdowns, screamed verses, clean sung chorus", bpm: "150-190" },
  { id: "nu_metal", nombre: "Nu metal", familia: "Metal", estilo: "nu metal, downtuned 7-string groove, scratching, rapped verses", bpm: "90-120" },
  { id: "groove_metal", nombre: "Groove metal", familia: "Metal", estilo: "groove metal, mid-tempo chugging riffs, barked vocals", bpm: "110-140" },
  { id: "metal_industrial", nombre: "Metal industrial", familia: "Metal", estilo: "industrial metal, machine drums, electronic layers, harsh vocals", bpm: "110-140" },

  // ---- Raíces ----
  { id: "blues", nombre: "Blues", familia: "Raíces", estilo: "blues, slide guitar, shuffle groove, harmonica, smoky feel", bpm: "60-100" },
  { id: "blues_rock", nombre: "Blues rock", familia: "Raíces", estilo: "blues rock, overdriven guitar, hammond organ, big shuffle", bpm: "100-130" },
  { id: "funk", nombre: "Funk", familia: "Raíces", estilo: "funk, slap bass, wah guitar, tight horn stabs, pocket drums", bpm: "95-115" },
  { id: "soul", nombre: "Soul", familia: "Raíces", estilo: "soul, warm rhodes, string pads, gospel-tinged vocals", bpm: "70-95" },
  { id: "gospel", nombre: "Gospel", familia: "Raíces", estilo: "gospel, hammond organ, full choir, handclaps, uplifting", bpm: "80-110" },
  { id: "reggae", nombre: "Reggae", familia: "Raíces", estilo: "reggae, offbeat skank guitar, deep bass, laid-back drums", bpm: "70-90" },
  { id: "dub", nombre: "Dub", familia: "Raíces", estilo: "dub, cavernous delay, spring reverb, dropouts, heavy bass", bpm: "70-90" },
  { id: "ska", nombre: "Ska", familia: "Raíces", estilo: "ska, upstroke guitar, bright horn section, walking bass", bpm: "140-165" },
  { id: "bossa", nombre: "Bossa nova", familia: "Raíces", estilo: "bossa nova, nylon guitar, brushed drums, soft syncopation", bpm: "120-140" },
  { id: "samba", nombre: "Samba", familia: "Raíces", estilo: "samba, cavaquinho, surdo, pandeiro, carnival energy", bpm: "95-110" },

  // ---- Electrónica ----
  { id: "house", nombre: "House", familia: "Electrónica", estilo: "house, four on the floor, warm bassline, vocal chops", bpm: "120-128" },
  { id: "amapiano", nombre: "Amapiano", familia: "Electrónica", estilo: "amapiano, log drum bass, shakers, spacious piano", bpm: "110-118" },
  { id: "edm", nombre: "EDM / Festival", familia: "Electrónica", estilo: "big room edm, huge build up, festival drop", bpm: "126-132" },
  { id: "dnb", nombre: "Drum and bass", familia: "Electrónica", estilo: "drum and bass, breakbeat, rolling sub bass", bpm: "172-176" },
  { id: "lofi", nombre: "Lo-fi", familia: "Electrónica", estilo: "lofi hip hop, dusty drums, vinyl crackle, mellow keys", bpm: "70-85" },
  { id: "ambient", nombre: "Ambient", familia: "Electrónica", estilo: "ambient, slow evolving pads, field recordings, no drums", bpm: "60-80" },
  { id: "synthwave", nombre: "Synthwave", familia: "Electrónica", estilo: "synthwave, analog arpeggios, gated reverb drums, neon mood", bpm: "100-120" },
  { id: "trip_hop", nombre: "Trip hop", familia: "Electrónica", estilo: "trip hop, dusty breakbeat, deep bass, cinematic samples", bpm: "80-95" },
  { id: "chiptune", nombre: "Chiptune", familia: "Electrónica", estilo: "chiptune, 8-bit square leads, arpeggios, retro game energy", bpm: "130-165" },

  // ---- Otros ----
  { id: "balada", nombre: "Balada pop", familia: "Otros", estilo: "pop ballad, piano, strings, big emotional chorus", bpm: "65-80" },
  { id: "pop", nombre: "Pop", familia: "Otros", estilo: "modern pop, bright synths, tight drums, radio chorus", bpm: "100-120" },
  { id: "jazz", nombre: "Jazz", familia: "Otros", estilo: "jazz, upright bass, brushed drums, smoky vocals", bpm: "90-120" },
  { id: "country", nombre: "Country", familia: "Otros", estilo: "country, acoustic guitar, pedal steel, storytelling", bpm: "90-120" },
  { id: "kpop", nombre: "K-pop", familia: "Otros", estilo: "k-pop, glossy production, layered harmonies, dance break", bpm: "110-130" },
  { id: "acustico", nombre: "Acústico", familia: "Otros", estilo: "acoustic, single guitar, intimate close-mic vocals", bpm: "70-90" },
  { id: "coral", nombre: "Coral / Épico", familia: "Otros", estilo: "epic choir, orchestral percussion, cinematic build", bpm: "70-90" },
  { id: "orquestal", nombre: "Orquestal / Cine", familia: "Otros", estilo: "orchestral score, strings, woodwinds, timpani, cinematic", bpm: "60-110" },
] as const;

/** Las familias, en el orden en que se enseñan. */
export const FAMILIAS = ["Latino", "Andino", "Urbano", "Raíces", "Rock", "Metal", "Electrónica", "Otros"] as const;

/**
 * Mezclas que funcionan, con el porqué.
 *
 * Juntar dos géneros al azar suele dar un revoltijo: lo que hace que una
 * fusión suene a algo es que cada uno aporte una cosa distinta —uno la base
 * rítmica, otro la armonía o el timbre— y que compartan algo (el tempo, la
 * escala, la actitud). Esta lista es de las que se sostienen; sirve de atajo y
 * de ejemplo de lo que se le puede pedir.
 */
export const FUSIONES: { ids: [string, string]; nombre: string; nota: string }[] = [
  { ids: ["jazz", "metal"], nombre: "Jazz + metal", nota: "Riff pesado de base y armonía de jazz encima: acordes con tensiones sobre palm mute, y el solo se lo lleva el saxo o el órgano en vez de la guitarra." },
  { ids: ["blues", "stoner"], nombre: "Blues + stoner", nota: "El blues ya está dentro del stoner: baja la afinación, alarga el shuffle y deja la slide guitar al frente. Suena a desierto." },
  { ids: ["blues", "trip_hop"], nombre: "Blues + trip hop", nota: "Para fondo: el breakbeat lento sostiene y la guitarra de blues aparece a ratos, con mucho espacio. Sale ambiente sin quedarse plano." },
  { ids: ["blues", "gospel"], nombre: "Blues + gospel", nota: "Misma raíz, distinta luz: órgano hammond y coro sobre el shuffle. El clímax se construye solo." },
  { ids: ["cumbia", "dub"], nombre: "Cumbia + dub", nota: "La cumbia da el patrón y el dub lo vacía: delays largos, bajo enorme y silencios. La mejor de las fusiones para fondo de vídeo." },
  { ids: ["cumbia", "psicodelico"], nombre: "Cumbia + psicodélico", nota: "Cumbia peruana de manual: órgano con fuzz, guitarra con reverb de muelles y la percusión seca delante." },
  { ids: ["huayno", "post_rock"], nombre: "Huayño + post-rock", nota: "La quena y el charango llevan la melodía y las guitarras limpias construyen debajo hasta el estallido. Épico sin voz." },
  { ids: ["morenada", "metal_sinfonico"], nombre: "Morenada + metal sinfónico", nota: "Los metales de la banda y la matraca contra la orquesta: sale marcial de verdad. Cuidado con el tempo, que la morenada es lenta." },
  { ids: ["saya", "funk"], nombre: "Saya + funk", nota: "Los tambores afrobolivianos con bajo slap y vientos cortados. Se baila desde el primer compás." },
  { ids: ["tango", "drum_and_bass"], nombre: "Tango + drum and bass", nota: "El bandoneón sobre un breakbeat a 174: la melodía dramática se sostiene, el ritmo la empuja." },
  { ids: ["bossa", "lofi"], nombre: "Bossa + lo-fi", nota: "Para estudiar o para fondo: guitarra de nylon, escobillas, ruido de vinilo y nada que llame la atención." },
  { ids: ["flamenco", "metal"], nombre: "Flamenco + metal", nota: "Falsetas y palmas contra riffs: la escala frigia ya es común a los dos, así que casan sin esfuerzo." },
  { ids: ["salsa", "hard_rock"], nombre: "Salsa + hard rock", nota: "Montuno de piano y timbales con guitarra distorsionada encima. Los vientos hacen de coro del riff." },
  { ids: ["reggaeton", "rock"], nombre: "Reggaetón + rock", nota: "Dembow con guitarras: el patrón se mantiene y el riff sustituye al sintetizador. Funciona si el bajo no se pelea con el 808." },
  { ids: ["ambient", "orquestal"], nombre: "Ambient + orquestal", nota: "Colchón de cuerdas y pads que no van a ninguna parte: música de fondo para hablar encima, sin melodía que distraiga." },
  { ids: ["ambient", "andino"], nombre: "Ambient + andino", nota: "Pads largos con quena y viento grabado: paisaje de altiplano. Nada de percusión." },
  { ids: ["synthwave", "metal"], nombre: "Synthwave + metal", nota: "Arpegios analógicos y guitarra a galope. Suena a película de los ochenta." },
  { ids: ["jazz", "trip_hop"], nombre: "Jazz + trip hop", nota: "Contrabajo y trompeta con sordina sobre un break lento y sucio. Cine negro." },
  { ids: ["chiptune", "punk_rock"], nombre: "Chiptune + punk", nota: "8 bits con batería rápida: dos minutos y fuera. Para intros y para vídeos de juegos." },
  { ids: ["gospel", "house"], nombre: "Gospel + house", nota: "El coro y el órgano sobre el bombo a negras: es de donde salió el house, así que vuelve a casa." },
];

/** Las mezclas propuestas para un ritmo: el atajo de "¿con qué junto esto?". */
export const fusionesDe = (id: string) => FUSIONES.filter((f) => f.ids.includes(id));

export type Ritmo = (typeof RITMOS)[number]["id"];
export const esRitmo = (v: string): v is Ritmo => RITMOS.some((r) => r.id === v);
export const buscarRitmo = (id: string) => RITMOS.find((r) => r.id === id) ?? null;

/** De quién es la letra que se pega. Decide qué se puede hacer con ella. */
export const ORIGENES = ["propia", "ajena"] as const;
export type Origen = (typeof ORIGENES)[number];

/**
 * Una versión: la canción en un ritmo, con las tres cajas de Suno (letra,
 * estilo y exclusiones) listas para copiar.
 */
export const VersionRemixSchema = z.object({
  ritmo: z.string().max(40),
  titulo: z.string().min(1).max(120),
  /** Caja "Style of Music". Corto a propósito: Suno se pierde con párrafos. */
  estilo: z.string().min(3).max(200),
  /** Caja "Exclude styles": lo que NO se quiere oír. */
  excluir: z.string().max(200).default(""),
  bpm: z.string().max(20).default(""),
  tonalidad: z.string().max(40).default(""),
  /** La letra con las etiquetas de sección de Suno ([Verse], [Chorus]...). */
  letra: z.string().min(20).max(4000),
  /** Cómo cantarla y producirla: voz, instrumentación, dinámica. */
  indicaciones: z.string().max(600).default(""),
  /** Los 15 segundos que van en el corto vertical. */
  gancho: z.string().max(300).default(""),
  /** Por qué esta versión puede funcionar. Sin humo. */
  porQue: z.string().max(400).default(""),
});

export const RemixSchema = z.object({
  /** De qué habla la canción, en una frase: lo que sobrevive a todos los ritmos. */
  esencia: z.string().max(400).default(""),
  versiones: z.array(VersionRemixSchema).min(1).max(6),
  /** Ganchos para el texto de la publicación (no se cantan). */
  ganchos: z.array(z.string().min(1).max(150)).max(4).default([]),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
  motorUsado: z.string().max(20).optional(),
  avisoMotor: z.string().max(300).optional(),
  /** Frases del original que se colaron tal cual (solo con letra ajena). */
  calcos: z.array(z.string().max(300)).max(20).default([]),
  /** Acotaciones que se sacaron de la letra: Suno las habría cantado. */
  avisos: z.array(z.string().max(300)).max(20).default([]),
});

export type VersionRemix = z.infer<typeof VersionRemixSchema>;
export type Remix = z.infer<typeof RemixSchema>;

export type PeticionRemix = {
  motor?: string | null;
  modelo?: string | null;
  /** La letra de partida, o vacío si solo hay tema. */
  letra?: string;
  /** De quién es esa letra. Sin esto no se decide nada. */
  origen: Origen;
  /** Tema o idea, por si no hay letra (o para orientar el remix). */
  tema?: string;
  titulo?: string;
  /** Ritmos a los que llevarla. */
  ritmos: string[];
  /** Exprimir el formato corto: gancho en los primeros segundos y frase repetible. */
  viral?: boolean;
  idioma?: string;
  region?: string;
  modismos?: boolean;
  /** Notas del autor: qué conservar, qué cambiar, qué no tocar. */
  notas?: string;
};

const normalizar = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Frases del original que aparecen tal cual en lo generado.
 *
 * Con letra ajena esto es lo que separa "inspirado en" de "copiado": el
 * modelo puede decir que escribió algo original y colar igualmente el
 * estribillo. Se comparan frases de seis palabras o más, sin tildes ni
 * puntuación, que es como se reconoce un verso aunque le cambien una coma.
 */
export function calcosDelOriginal(original: string, generado: string): string[] {
  const texto = normalizar(generado);
  const encontrados = new Set<string>();
  for (const linea of original.split(/\r?\n/)) {
    const limpia = linea.trim();
    if (!limpia || /^\[.*\]$/.test(limpia)) continue;
    const n = normalizar(limpia);
    if (n.split(" ").length < 6) continue;
    if (texto.includes(n)) encontrados.add(limpia.slice(0, 300));
  }
  return [...encontrados].slice(0, 20);
}

/** Las etiquetas de sección que entiende Suno, para recordárselas al modelo. */
const ETIQUETAS = "[Intro] [Verse] [Pre-Chorus] [Chorus] [Post-Chorus] [Bridge] [Drop] [Break] [Outro]";

export async function generarRemix(p: PeticionRemix): Promise<Remix> {
  // Primero lo que depende de lo que escribió el usuario: si falta un dato
  // suyo, el mensaje tiene que hablar de eso y no de la configuración.
  const letra = (p.letra ?? "").trim();
  const tema = (p.tema ?? "").trim();
  if (!letra && !tema) throw new Error("Pega la letra o escribe de qué va la canción");

  const ritmos = p.ritmos.map(buscarRitmo).filter((r): r is (typeof RITMOS)[number] => r !== null).slice(0, 6);
  if (!ritmos.length) throw new Error("Ninguno de esos ritmos existe: elige alguno de la lista");

  const elegido = (p.motor && esMotor(p.motor) ? p.motor : null) ?? motorDisponible();
  if (!elegido) {
    throw new Error(
      "No hay ningun motor de IA configurado: añade una clave de Groq, Gemini, OpenAI o Claude en Ajustes",
    );
  }

  const ajena = p.origen === "ajena";
  const idioma = p.idioma ?? "es";

  const prompt = [
    `Eres compositor y productor. Tienes que entregar ${ritmos.length} versiones de una canción, una por ritmo,`,
    "listas para generarlas en Suno.",
    "",
    ajena
      ? [
          "IMPORTANTE — La letra de partida NO es de quien te la entrega, así que está PROHIBIDO:",
          "reescribirla, parafrasearla, traducirla, reordenarla o reutilizar sus versos, su título o su estribillo.",
          "Lo único que puedes tomar es el TEMA y la EMOCIÓN. Escribe canciones COMPLETAMENTE ORIGINALES sobre",
          "ese tema, con imágenes, metáforas y estribillos nuevos. Si una frase tuya se parece a una del original,",
          "cámbiala. No menciones al artista ni el título original en ninguna parte.",
        ].join("\n")
      : "La letra es de quien te la entrega: puedes reescribirla, recortarla, alargarla y adaptarla a cada ritmo.",
    "",
    p.titulo ? `Título de partida: ${p.titulo}` : "",
    tema ? `Tema: ${tema}` : "",
    (p.notas ?? "").trim() ? `Indicaciones del autor, que mandan sobre todo lo demás: ${p.notas}` : "",
    "",
    "Los ritmos, con su descriptor para Suno y su tempo habitual:",
    ...ritmos.map((r) => `- ${r.nombre} (id "${r.id}"): ${r.estilo} · ${r.bpm} BPM`),
    "",
    "Cada versión tiene que traer:",
    `- "letra": la canción entera con las etiquetas de sección de Suno (${ETIQUETAS}).`,
    "  Entre corchetes SOLO van etiquetas que Suno entienda, en inglés y de esta lista:",
    `  ${VOCABULARIO}.`,
    "  Nada de acotaciones entre corchetes ('[la guitarra entra con rabia]'): Suno no las entiende y las CANTA.",
    '  Todo lo que sea una indicación para quien lo monta va en "indicaciones", no en la letra.',
    '- "estilo": la caja "Style of Music" de Suno. MENOS DE 180 CARACTERES, en inglés, separada por comas:',
    "  género, instrumentos, tipo de voz, energía. Sin frases largas: Suno se pierde.",
    '- "excluir": lo que no se quiere oír, en inglés y corto (por ejemplo "no autotune, no edm drop").',
    '- "bpm" y "tonalidad": el tempo y la tonalidad que le van a esta versión.',
    '- "indicaciones": en español, cómo cantarla y producirla, y qué cambia respecto a las otras versiones.',
    '- "gancho": el trozo exacto (una o dos frases) que iría en los 15 segundos del corto vertical.',
    '- "porQue": por qué este ritmo le sienta bien a este tema. Una o dos frases, sin humo.',
    "",
    "Reglas de escritura:",
    "- La misma idea en todos los ritmos, pero NO la misma letra: cada género pide su métrica, su vocabulario y su acentuación.",
    "- El estribillo tiene que poder cantarse a la primera: frases cortas, palabras comunes, una imagen que se vea.",
    "- Nada de rimas de relleno ni de versos que no digan nada por cuadrar la métrica.",
    "- Nada de marcas, ni de personas reales identificables, ni de menciones a otros artistas.",
    idioma === "spanglish"
      ? [
          "- SPANGLISH: es como se canta media América. La base va en español y el inglés entra donde",
          "  entra de verdad: el gancho, el estribillo, el remate de una frase ('baby', 'let's go',",
          "  'one more time', 'te escribo later'). En cumbia y en reggaetón el estribillo en inglés es",
          "  lo que se queda pegado; en una balada, mejor una frase suelta. Nunca la misma frase en los",
          "  dos idiomas, y nada de inglés puesto por quedar bien.",
        ].join("\n")
      : "",
    p.viral
      ? [
          "- FORMATO CORTO: cada versión empieza por lo más fuerte. La primera frase que se oye tiene que parar el dedo,",
          "  el estribillo llega antes de los 15 segundos y hay UNA frase corta que se repite y se queda pegada.",
          "  Piensa en que alguien la va a usar de fondo en un vídeo de 20 segundos.",
        ].join("\n")
      : "",
    ORTOGRAFIA,
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "esencia": "de qué habla la canción, en una frase",',
    '  "versiones": [',
    '    { "ritmo": "id del ritmo", "titulo": "...", "estilo": "...", "excluir": "...", "bpm": "...",',
    '      "tonalidad": "...", "letra": "[Intro]\\n...", "indicaciones": "...", "gancho": "...", "porQue": "..." }',
    "  ],",
    '  "ganchos": ["texto para publicar el corto", "otro"],',
    '  "hashtags": ["sinAlmohadilla", "otro"]',
    "}",
    "",
    letra ? `${ajena ? "LETRA AJENA (solo para entender el tema; no la reutilices)" : "LETRA ORIGINAL"}:\n${letra.slice(0, 6000)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const informe: InformeMotor = {};
  const crudo = await textoConMotor(
    elegido as Motor,
    prompt,
    p.modelo,
    idioma,
    p.region ?? "bolivia",
    p.modismos ?? true,
    informe,
  );
  if (!crudo) throw new Error(`El motor ${informe.motor ?? elegido} no devolvió contenido`);

  const datos = extraerJSON(crudo) as Record<string, unknown>;
  const remix = RemixSchema.parse({ ...datos, motorUsado: informe.motor, avisoMotor: informe.aviso });

  // El nombre del ritmo, el que eligió el usuario: el modelo a veces devuelve
  // el id y a veces su propia etiqueta. Y de paso se revisan los corchetes: lo
  // que no sea una etiqueta de Suno sale de la letra, porque se cantaría.
  const avisos: string[] = [];
  const versiones = remix.versiones.slice(0, ritmos.length).map((v, i) => {
    const revision = revisarEtiquetas(v.letra);
    for (const s of revision.sacadas) {
      avisos.push(`"${s}" estaba entre corchetes en la letra y Suno lo habría cantado: se quitó.`);
    }
    for (const c of revision.cambiadas) {
      avisos.push(`[${c.de}] se escribió como [${c.a}], que es la etiqueta que Suno entiende.`);
    }
    return {
      ...v,
      letra: revision.texto,
      ritmo: buscarRitmo(v.ritmo)?.nombre ?? ritmos[i]?.nombre ?? v.ritmo,
    };
  });

  return {
    ...remix,
    versiones,
    avisos: [...new Set(avisos)].slice(0, 20),
    // Con letra ajena, lo que de verdad importa: comprobar que no se coló.
    calcos: ajena && letra ? calcosDelOriginal(letra, versiones.map((v) => `${v.titulo}\n${v.letra}\n${v.gancho}`).join("\n")) : [],
  };
}

/** Todo el remix en un texto para copiar o descargar, versión por versión. */
export function remixATexto(remix: Remix, titulo = "Remix"): string {
  const partes: string[] = [`# ${titulo}`];
  if (remix.esencia) partes.push(`Esencia: ${remix.esencia}`);
  if (remix.motorUsado) partes.push(`Escrito con: ${remix.motorUsado}`);
  partes.push("");

  for (const v of remix.versiones) {
    partes.push(
      `## ${v.ritmo} — ${v.titulo}`,
      "",
      "### Suno · Style of Music",
      v.estilo,
      ...(v.excluir ? ["", "### Suno · Exclude styles", v.excluir] : []),
      "",
      `### Tempo y tono`,
      [v.bpm ? `${v.bpm} BPM` : "", v.tonalidad].filter(Boolean).join(" · ") || "(sin indicar)",
      "",
      "### Letra (pégala en el campo Lyrics, modo Custom)",
      v.letra,
      "",
      ...(v.indicaciones ? ["### Cómo cantarla", v.indicaciones, ""] : []),
      ...(v.gancho ? ["### Los 15 segundos del corto", v.gancho, ""] : []),
      ...(v.porQue ? ["### Por qué este ritmo", v.porQue, ""] : []),
      "---",
      "",
    );
  }

  if (remix.ganchos.length) partes.push("## Para publicar", ...remix.ganchos.map((g) => `- ${g}`), "");
  if (remix.hashtags.length) partes.push(remix.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" "), "");
  if (remix.avisos.length) {
    partes.push("## Etiquetas revisadas", ...remix.avisos.map((a) => `- ${a}`), "");
  }
  if (remix.calcos.length) {
    partes.push(
      "## Revisar antes de publicar",
      "Estas frases del original aparecen tal cual en el resultado. Cámbialas: no son tuyas.",
      ...remix.calcos.map((c) => `- ${c}`),
      "",
    );
  }
  return partes.join("\n");
}

/** Cómo usar cada versión en Suno. Es siempre lo mismo, así que vive aquí. */
export const INSTRUCCIONES_SUNO = [
  "1. Entra en Suno y activa el modo **Custom**.",
  "2. Pega la **Letra** en el campo de lyrics, con sus etiquetas ([Verse], [Chorus]...): son las que marcan la estructura.",
  "3. Pega el **Style of Music** tal cual; no lo alargues, que se diluye.",
  "4. Si hay **Exclude styles**, pégalo en ese campo.",
  "5. Pon el **título** de la versión y genera. Suele hacer falta más de un intento: cambia una palabra del estilo, no toda la caja.",
  "6. Cuando te guste, copia el enlace de la canción y tráelo a la pestaña Videoclip para montar el vídeo.",
];

// ------------------------------------------------- Instrumentales y fusiones

/** Para qué es la pista: cambia la estructura, no solo el estilo. */
export const USOS = [
  { id: "ambiente", nombre: "Ambiente (fondo, sin llamar la atención)", pista: "nada de melodía pegadiza ni cambios bruscos; tiene que poder sonar debajo de una voz" },
  { id: "concentracion", nombre: "Concentración / estudio", pista: "repetitiva a propósito, sin sorpresas, sin solos largos ni silencios raros" },
  { id: "entrenamiento", nombre: "Entrenamiento", pista: "tempo estable y alto, energía constante, sin bajones a mitad" },
  { id: "intro", nombre: "Intro de vídeo (10-20 s)", pista: "entra fuerte, dice lo suyo y termina con un remate claro" },
  { id: "fondo_video", nombre: "Fondo de un vídeo hablado", pista: "rango medio despejado para que la voz se oiga encima; los graves y los agudos hacen el trabajo" },
  { id: "club", nombre: "Club / fiesta", pista: "construcción y caída claras, la gente tiene que saber cuándo viene" },
  { id: "cine", nombre: "Cine / épico", pista: "crece de menos a más, con un clímax que se ve venir y un final que baja" },
] as const;

export type Uso = (typeof USOS)[number]["id"];

export const SeccionInstrumentalSchema = z.object({
  /** Etiqueta de Suno, sin corchetes: "Intro", "Guitar Solo"... */
  etiqueta: z.string().min(1).max(60),
  segundos: z.number().min(2).max(300).optional(),
  /** Qué pasa ahí, en español. Es una nota para quien lo monta, NO va a Suno. */
  que: z.string().max(300).default(""),
});

export const InstrumentalSchema = z.object({
  titulo: z.string().min(1).max(120),
  /** Caja "Style of Music" con la mezcla ya descrita. */
  estilo: z.string().min(3).max(200),
  excluir: z.string().max(200).default(""),
  bpm: z.string().max(20).default(""),
  tonalidad: z.string().max(40).default(""),
  /** Qué aporta cada género a la mezcla. Una línea por género. */
  aportes: z.array(z.string().max(200)).max(6).default([]),
  estructura: z.array(SeccionInstrumentalSchema).min(2).max(14),
  /** Notas de arreglo para quien lo monta; nunca se pegan en Suno. */
  indicaciones: z.string().max(800).default(""),
  porQue: z.string().max(400).default(""),
  /** Letra, solo si se pidió con voz. Vacío = instrumental de verdad. */
  letra: z.string().max(4000).default(""),
  motorUsado: z.string().max(20).optional(),
  avisoMotor: z.string().max(300).optional(),
});

export type Instrumental = z.infer<typeof InstrumentalSchema> & {
  /** Lo que se pega EN LA CAJA DE LETRA de Suno: etiquetas, o letra con ellas. */
  cajaLetra: string;
  /** Acotaciones que el modelo metió entre corchetes y se habrían cantado. */
  avisos: string[];
  /** Etiquetas que estaban mal escritas y se corrigieron. */
  corregidas: { de: string; a: string }[];
  conVoz: boolean;
};

export type PeticionInstrumental = {
  motor?: string | null;
  modelo?: string | null;
  /** Los géneros que se mezclan: de dos a cuatro. */
  ritmos: string[];
  uso: string;
  duracion?: number;
  /** 1 = casi silencio, 5 = a tope. */
  energia?: number;
  /** Lo que quiera quien pide: instrumentos, referencias, qué evitar. */
  notas?: string;
  /** Con voz, en vez de instrumental puro. */
  conLetra?: boolean;
  tema?: string;
  idioma?: string;
  region?: string;
  modismos?: boolean;
};

/**
 * Escribe la pista: la mezcla descrita como Suno la entiende, la estructura en
 * etiquetas y, si se pide, la letra.
 *
 * Lo que aporta de verdad esta función no es el texto, es la **separación**:
 * lo que va en la caja de letra de Suno (etiquetas y, si acaso, versos) se
 * devuelve aparte de lo que es una nota de arreglo para una persona. Un modelo
 * de texto mezcla las dos cosas siempre —escribe `[la guitarra entra con
 * rabia]` porque es lo natural en un guion— y Suno eso se lo canta.
 */
export async function generarInstrumental(p: PeticionInstrumental): Promise<Instrumental> {
  const ritmos = p.ritmos.map(buscarRitmo).filter((r): r is (typeof RITMOS)[number] => r !== null).slice(0, 4);
  if (ritmos.length < 1) throw new Error("Elige al menos un género (dos o tres si quieres una mezcla)");

  const elegido = (p.motor && esMotor(p.motor) ? p.motor : null) ?? motorDisponible();
  if (!elegido) {
    throw new Error(
      "No hay ningun motor de IA configurado: añade una clave de Groq, Gemini, OpenAI o Claude en Ajustes",
    );
  }

  const uso = USOS.find((u) => u.id === p.uso) ?? USOS[0];
  const duracion = p.duracion ?? 120;
  const conLetra = Boolean(p.conLetra);
  const idioma = p.idioma ?? "es";
  const energia = Math.min(5, Math.max(1, Math.round(p.energia ?? 3)));
  const conocida = ritmos.length === 2 ? FUSIONES.find((f) => f.ids.every((id) => ritmos.some((r) => r.id === id))) : null;

  const prompt = [
    conLetra
      ? `Escribe una canción de unos ${duracion} segundos mezclando estos géneros, lista para generarla en Suno.`
      : `Escribe una pista INSTRUMENTAL (sin voz) de unos ${duracion} segundos mezclando estos géneros, lista para generarla en Suno.`,
    "",
    "Los géneros que se mezclan, con su descriptor y su tempo habitual:",
    ...ritmos.map((r) => `- ${r.nombre}: ${r.estilo} · ${r.bpm} BPM`),
    conocida ? `Esta mezcla es conocida y funciona así: ${conocida.nota}` : "",
    "",
    `Para qué es: ${uso.nombre}. ${uso.pista}.`,
    `Energía: ${energia} de 5.`,
    p.tema ? `De qué habla o qué evoca: ${p.tema}.` : "",
    (p.notas ?? "").trim() ? `Indicaciones de quien la pide, que mandan: ${p.notas}` : "",
    "",
    "Cómo se hace una mezcla que suene a algo y no a revoltijo:",
    "- Cada género aporta UNA cosa: uno la base rítmica, otro la armonía, otro el timbre o el solo. Dilo en \"aportes\".",
    "- Tiene que haber algo común (el tempo, la escala o la actitud) o las dos mitades se pelean.",
    "- Un tempo y una tonalidad para toda la pista: si un género pide otro, se adapta él.",
    conLetra ? "" : "- SIN VOZ: nada de versos, nada de coros, nada de 'la la la'. Si hace falta voz humana, que sea un pad de coros sin palabras y se dice en el estilo.",
    "",
    "Sobre las ETIQUETAS, que es donde todo el mundo se equivoca:",
    "- En Suno, lo que va entre corchetes en la caja de letra es una INSTRUCCIÓN, no algo que se canta,",
    "  y solo funciona si Suno la reconoce. Usa únicamente estas, en inglés y tal cual:",
    `  ${VOCABULARIO}.`,
    "  También vale una etiqueta corta en inglés con un instrumento: [Trumpet Solo], [Bass Drop], [Blast Beats].",
    "- NUNCA escribas acotaciones entre corchetes ('[la guitarra entra con rabia]', '[se escucha una puerta]'):",
    "  Suno no las entiende y acaba CANTÁNDOLAS dentro del tema. Todo eso va en \"que\" y en \"indicaciones\",",
    "  que las lee una persona y no se pegan en Suno.",
    "",
    "Devuelve exactamente este JSON:",
    "{",
    '  "titulo": "título corto de la pista",',
    '  "estilo": "style of music para Suno, EN INGLÉS, menos de 180 caracteres, separado por comas: géneros mezclados, instrumentos, energía",',
    '  "excluir": "lo que no se quiere oír, en inglés y corto",',
    '  "bpm": "tempo",  "tonalidad": "tonalidad y modo",',
    `  "aportes": [${ritmos.map((r) => `"${r.nombre}: qué pone en la mezcla"`).join(", ")}],`,
    '  "estructura": [ { "etiqueta": "Intro", "segundos": 8, "que": "qué pasa aquí, en español, para quien lo monta" } ],',
    '  "indicaciones": "notas de arreglo en español: dinámica, mezcla, qué evitar",',
    '  "porQue": "por qué esta mezcla funciona, una o dos frases",',
    conLetra ? '  "letra": "la letra con sus etiquetas de sección"' : '  "letra": ""',
    "}",
    `La estructura tiene que sumar unos ${duracion} segundos.`,
    ORTOGRAFIA,
  ]
    .filter(Boolean)
    .join("\n");

  const informe: InformeMotor = {};
  const crudo = await textoConMotor(
    elegido as Motor,
    prompt,
    p.modelo,
    idioma,
    p.region ?? "bolivia",
    p.modismos ?? true,
    informe,
  );
  if (!crudo) throw new Error(`El motor ${informe.motor ?? elegido} no devolvió contenido`);

  const datos = InstrumentalSchema.parse({
    ...(extraerJSON(crudo) as Record<string, unknown>),
    motorUsado: informe.motor,
    avisoMotor: informe.aviso,
  });

  // Aquí se separa lo que va a Suno de lo que no. Las etiquetas se pasan por
  // el vocabulario real; lo que no lo sea, se saca y se avisa.
  const avisos: string[] = [];
  const corregidas: { de: string; a: string }[] = [];
  const estructura = datos.estructura.map((s) => {
    const canonica = etiquetaCanonica(s.etiqueta);
    if (!canonica) {
      avisos.push(`"${s.etiqueta}" no es una etiqueta que Suno entienda: se deja como nota de arreglo.`);
      return { ...s, etiqueta: "", que: [s.etiqueta, s.que].filter(Boolean).join(" · ") };
    }
    if (canonica !== s.etiqueta.trim()) corregidas.push({ de: s.etiqueta.trim(), a: canonica });
    return { ...s, etiqueta: canonica };
  });

  let cajaLetra: string;
  if (conLetra && datos.letra.trim()) {
    const revision = revisarEtiquetas(datos.letra);
    cajaLetra = revision.texto;
    corregidas.push(...revision.cambiadas);
    for (const s of revision.sacadas) {
      avisos.push(`Se sacó de la letra "[${s}]": Suno lo habría cantado. Está en las notas de arreglo.`);
    }
  } else {
    // Instrumental: en la caja de letra van SOLO las etiquetas, una por línea.
    cajaLetra = estructura.map((s) => s.etiqueta).filter(Boolean).map((e) => `[${e}]`).join("\n");
  }

  const notasSueltas = estructura
    .filter((s) => !s.etiqueta && s.que)
    .map((s) => s.que)
    .join(" · ");

  return {
    ...datos,
    estructura: estructura.filter((s) => s.etiqueta),
    indicaciones: [datos.indicaciones, notasSueltas].filter(Boolean).join("\n"),
    cajaLetra,
    avisos,
    corregidas,
    conVoz: conLetra,
  };
}

/** La pista entera en un texto, con cada caja de Suno separada. */
export function instrumentalATexto(p: Instrumental): string {
  const partes = [
    `# ${p.titulo}`,
    p.porQue,
    "",
    "## Suno · Style of Music",
    p.estilo,
    ...(p.excluir ? ["", "## Suno · Exclude styles", p.excluir] : []),
    "",
    "## Tempo y tono",
    [p.bpm ? `${p.bpm} BPM` : "", p.tonalidad].filter(Boolean).join(" · ") || "(sin indicar)",
    "",
    `## Suno · Lyrics${p.conVoz ? "" : " (solo las etiquetas: la pista es instrumental)"}`,
    p.cajaLetra,
    "",
  ];
  if (p.aportes.length) partes.push("## Qué pone cada género", ...p.aportes.map((a) => `- ${a}`), "");
  if (p.estructura.length) {
    partes.push("## Estructura");
    for (const s of p.estructura) {
      partes.push(`- [${s.etiqueta}]${s.segundos ? ` · ${s.segundos}s` : ""}${s.que ? ` — ${s.que}` : ""}`);
    }
    partes.push("");
  }
  if (p.indicaciones) partes.push("## Notas de arreglo (NO se pegan en Suno)", p.indicaciones, "");
  if (p.avisos.length) partes.push("## Revisado", ...p.avisos.map((a) => `- ${a}`), "");
  return partes.join("\n");
}

/** Cómo pedir una instrumental en Suno. No es lo mismo que una canción. */
export const INSTRUCCIONES_SUNO_INSTRUMENTAL = [
  "1. En Suno, modo **Custom**.",
  "2. Pega el **Style of Music** tal cual. Ahí está la mezcla: no la alargues.",
  "3. En la caja de **Lyrics** pega SOLO las etiquetas, una por línea: son la estructura, y sin voz que cantar Suno las usa como guion de la pista.",
  "4. Activa el interruptor **Instrumental**. Si lo dejas apagado y aun así quieres estructura, deja las etiquetas; si te canta algo igualmente, enciéndelo.",
  "5. Las **notas de arreglo** no se pegan en ningún sitio: son para ti, para saber qué pedir si hay que repetir la generación.",
  "6. Si sale bien a medias, cambia UNA cosa del estilo (un instrumento, una palabra de energía) y vuelve a generar. Cambiarlo entero es empezar de cero.",
];
