import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../env.js";
import { leerJSON } from "../util/http.js";
import { enFila } from "../util/fila.js";

export const VozSchema = z.object({
  proveedor: z.enum(["local", "gemini", "openai"]),
  modelo: z.string().min(1).max(80),
  nombre: z.string().min(1).max(40),
});
export type VozConfig = z.infer<typeof VozSchema>;

/**
 * Por defecto habla la voz local del servidor: no gasta cuota, no depende de
 * ninguna clave y siempre esta. Es robotica, pero sirve para probar el montaje
 * y para quien no quiera pagar voz. Las de IA se eligen cuando se quiera mas.
 */
export const VOZ_POR_DEFECTO: VozConfig = {
  proveedor: "local",
  modelo: "espeak-ng",
  nombre: env.VOZ_LOCAL_VOZ,
};

export const VOZ_GEMINI_POR_DEFECTO: VozConfig = {
  proveedor: "gemini",
  modelo: env.GEMINI_MODELO_VOZ,
  nombre: env.GEMINI_VOZ,
};

export const VOZ_OPENAI_POR_DEFECTO: VozConfig = {
  proveedor: "openai",
  modelo: env.OPENAI_MODELO_VOZ,
  nombre: env.OPENAI_VOZ,
};

/**
 * Voces locales, de mas robotica a mas natural. `motor` decide como se
 * sintetiza; `disponible` se comprueba en la maquina al arrancar.
 */
export type Genero = "masculino" | "femenino" | "desconocido";

export type VozLocal = {
  id: string;
  nombre: string;
  motor: "espeak" | "mbrola" | "piper";
  idioma: "es" | "en";
  calidad: 1 | 2 | 3;
  genero: Genero;
};

export const VOCES_LOCALES: VozLocal[] = [
  { id: "es-419", nombre: "espeak · español latino, hombre (robótica)", motor: "espeak", idioma: "es", calidad: 1, genero: "masculino" },
  { id: "es-419+f3", nombre: "espeak · español latino, mujer (robótica)", motor: "espeak", idioma: "es", calidad: 1, genero: "femenino" },
  { id: "es", nombre: "espeak · español de España, hombre (robótica)", motor: "espeak", idioma: "es", calidad: 1, genero: "masculino" },
  { id: "en-us", nombre: "espeak · inglés EE. UU., hombre (robótica)", motor: "espeak", idioma: "en", calidad: 1, genero: "masculino" },
  { id: "en-us+f3", nombre: "espeak · inglés EE. UU., mujer (robótica)", motor: "espeak", idioma: "en", calidad: 1, genero: "femenino" },
  { id: "mb-mx1", nombre: "MBROLA · mexicano 1 (natural)", motor: "mbrola", idioma: "es", calidad: 2, genero: "masculino" },
  { id: "mb-mx2", nombre: "MBROLA · mexicano 2 (natural)", motor: "mbrola", idioma: "es", calidad: 2, genero: "desconocido" },
  { id: "mb-vz1", nombre: "MBROLA · venezolano (natural)", motor: "mbrola", idioma: "es", calidad: 2, genero: "masculino" },
  { id: "mb-es1", nombre: "MBROLA · español 1 (natural)", motor: "mbrola", idioma: "es", calidad: 2, genero: "masculino" },
  { id: "mb-es2", nombre: "MBROLA · español 2 (natural)", motor: "mbrola", idioma: "es", calidad: 2, genero: "masculino" },
  { id: "piper:es_MX-claude-high", nombre: "Piper · mexicano, neural (la mejor)", motor: "piper", idioma: "es", calidad: 3, genero: "desconocido" },
  { id: "piper:es_AR-daniela-high", nombre: "Piper · argentina, mujer, neural", motor: "piper", idioma: "es", calidad: 3, genero: "femenino" },
  { id: "piper:es_ES-davefx-medium", nombre: "Piper · español de España, hombre, neural", motor: "piper", idioma: "es", calidad: 3, genero: "masculino" },
  { id: "piper:en_US-lessac-medium", nombre: "Piper · inglés EE. UU., mujer, neural", motor: "piper", idioma: "en", calidad: 3, genero: "femenino" },
];

/** Género de las voces de IA, para poder filtrar en el selector. */
export const GENERO_VOZ_IA: Record<string, Genero> = {
  Kore: "femenino", Aoede: "femenino", Leda: "femenino", Zephyr: "femenino",
  Puck: "masculino", Charon: "masculino", Fenrir: "masculino", Orus: "masculino",
  coral: "femenino", nova: "femenino", shimmer: "femenino", sage: "femenino",
  echo: "masculino", onyx: "masculino", fable: "masculino", ash: "masculino", ballad: "masculino",
  alloy: "desconocido",
};

const PIPER_BIN = process.env.PIPER_BIN ?? "/opt/piper/piper";
const PIPER_VOCES = process.env.PIPER_VOCES ?? "/opt/piper/voces";
const MBROLA_DIR = "/usr/share/mbrola";

const existe = (ruta: string) => access(ruta).then(() => true, () => false);

/** Existe si se puede arrancar; el codigo de salida da igual (mbrola sale con error sin argumentos). */
async function hayBinario(nombre: string) {
  return new Promise<boolean>((resolve) => {
    const p = spawn(nombre, ["--version"]);
    p.on("error", () => resolve(false));
    p.on("close", () => resolve(true));
  });
}

let cacheDisponibles: VozLocal[] | null = null;

/** Las voces locales que de verdad funcionan en esta maquina. */
export async function vocesLocalesDisponibles(): Promise<VozLocal[]> {
  if (cacheDisponibles) return cacheDisponibles;
  const [espeak, mbrola, piper] = await Promise.all([
    hayBinario("espeak-ng"),
    hayBinario("mbrola"),
    existe(PIPER_BIN),
  ]);
  const salida: VozLocal[] = [];
  for (const v of VOCES_LOCALES) {
    if (v.motor === "espeak" && espeak) salida.push(v);
    else if (v.motor === "mbrola" && espeak && mbrola) {
      const carpeta = v.id.slice(3);
      if (await existe(join(MBROLA_DIR, carpeta, carpeta))) salida.push(v);
    } else if (v.motor === "piper" && piper) {
      if (await existe(join(PIPER_VOCES, `${v.id.slice(6)}.onnx`))) salida.push(v);
    }
  }
  cacheDisponibles = salida;
  return salida;
}

/** La mejor voz local disponible del idioma y, si se pide, del género. */
export async function mejorVozLocal(idioma: "es" | "en" = "es", genero?: Genero): Promise<string> {
  const todas = (await vocesLocalesDisponibles()).filter((v) => v.idioma === idioma);
  const lista = genero && genero !== "desconocido" ? todas.filter((v) => v.genero === genero) : todas;
  return (lista.length ? lista : todas).sort((a, b) => b.calidad - a.calidad)[0]?.id ?? env.VOZ_LOCAL_VOZ;
}

/** Indicaciones entre corchetes ([pausa], [susurrando]...) que solo entiende Gemini. */
export const limpiarMarcas = (t: string) => t.replace(/\[[^\]\n]{1,40}\]/g, " ").replace(/\s+/g, " ").trim();

/** Voces disponibles; sirven para poblar el selector del frontend. */
export const VOCES = {
  local: VOCES_LOCALES.map((v) => v.id),
  gemini: ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"],
  openai: ["coral", "alloy", "echo", "fable", "onyx", "nova", "shimmer", "sage"],
} as const;

/**
 * Cómo tiene que sonar la narración. Va en la petición a Gemini y a OpenAI,
 * y por eso importa el idioma: pedir en español que narre "en español
 * latinoamericano" un texto en inglés es la forma más rápida de que salga con
 * acento raro, o directamente traducido.
 */
const INSTRUCCION = "Narra en español latinoamericano neutro, con voz cálida, pausada y cercana";
const INSTRUCCION_EN = "Narrate in neutral US English, with a warm, unhurried, close voice";

export const instruccionDeVoz = (idioma = "es") => (idioma === "en" ? INSTRUCCION_EN : INSTRUCCION);

/**
 * Las marcas entre corchetes ([pausa], [susurrando]...) no se pueden mandar
 * dentro del texto: un modelo de voz las lee en alto o las ignora. Aqui se
 * traducen a una indicacion de estilo que SI entiende, y el texto que se lee
 * sale limpio.
 */
const TONOS: [RegExp, string][] = [
  [/pausa|silencio/i, "marcando pausas donde el texto las pida"],
  [/susurr/i, "en voz muy baja, casi un susurro"],
  [/enfasis|énfasis|fuerte/i, "cargando el énfasis en las frases importantes"],
  [/lent|despacio/i, "más despacio de lo normal"],
  [/rapid|rápid|prisa/i, "algo más rápido de lo normal"],
  [/alegre|content|divertid/i, "con tono alegre"],
  [/serio|grave|solemn/i, "en tono serio"],
  [/triste|melanc/i, "con tono melancólico"],
  [/miedo|tens|suspens|misterio/i, "con tensión, como en una historia de suspenso"],
  [/emocion|entusias|energ/i, "con entusiasmo"],
  [/duda|pregunt/i, "con tono de duda"],
];

export function estiloDesdeMarcas(texto: string): { directiva: string; limpio: string } {
  const marcas = [...texto.matchAll(/\[([^\]\n]{1,40})\]/g)].map((m) => m[1]);
  const encontrados = new Set<string>();
  for (const marca of marcas) {
    for (const [patron, frase] of TONOS) if (patron.test(marca)) encontrados.add(frase);
  }
  return { directiva: [...encontrados].join(", "), limpio: limpiarMarcas(texto) };
}

/**
 * Modelos de voz que de verdad tiene la clave configurada.
 *
 * Google renombra los modelos de sintesis cada pocos meses; si el del entorno
 * ya no existe, la llamada devuelve 404 y el usuario solo ve "error al
 * comunicarse". Preguntando a la API cuales hay, la app se arregla sola y,
 * cuando no puede, dice exactamente que modelos existen.
 */
let cacheModelosVoz: { hasta: number; lista: string[] } | null = null;

export async function modelosVozGemini(forzar = false): Promise<string[]> {
  if (!env.GEMINI_API_KEY) return [];
  if (!forzar && cacheModelosVoz && cacheModelosVoz.hasta > Date.now()) return cacheModelosVoz.lista;

  const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", {
    headers: { "x-goog-api-key": env.GEMINI_API_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  const data = await leerJSON(res);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${data?.error?.message ?? "no se pudo listar los modelos"}`);

  const lista: string[] = (data.models ?? [])
    .map((m: { name?: string; supportedGenerationMethods?: string[] }) => ({
      nombre: String(m.name ?? "").replace(/^models\//, ""),
      metodos: m.supportedGenerationMethods ?? [],
    }))
    .filter((m: { nombre: string; metodos: string[] }) => /tts/i.test(m.nombre) && m.metodos.includes("generateContent"))
    .map((m: { nombre: string }) => m.nombre);

  cacheModelosVoz = { hasta: Date.now() + 10 * 60_000, lista };
  return lista;
}

/** El modelo de voz a usar: el pedido si existe, y si no el mejor disponible. */
export async function modeloVozGemini(preferido?: string | null, forzar = false): Promise<string> {
  const pedido = (preferido ?? env.GEMINI_MODELO_VOZ).trim() || env.GEMINI_MODELO_VOZ;
  const lista = await modelosVozGemini(forzar).catch(() => [] as string[]);
  if (lista.includes(pedido)) return pedido;
  // Sin lista (sin permiso para listar, o sin red) se prueba con el pedido.
  if (!lista.length) return pedido;
  // Los "flash" son los baratos y rápidos; es lo que quiere casi todo el mundo.
  return lista.find((n) => /flash/i.test(n)) ?? lista[0];
}

function pcmAWav(pcm: Buffer, rate = 24000): Buffer {
  const cab = Buffer.alloc(44);
  cab.write("RIFF", 0);
  cab.writeUInt32LE(36 + pcm.length, 4);
  cab.write("WAVE", 8);
  cab.write("fmt ", 12);
  cab.writeUInt32LE(16, 16);
  cab.writeUInt16LE(1, 20);
  cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(rate, 24);
  cab.writeUInt32LE(rate * 2, 28);
  cab.writeUInt16LE(2, 32);
  cab.writeUInt16LE(16, 34);
  cab.write("data", 36);
  cab.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([cab, pcm]);
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * El nivel gratuito de los proveedores de voz limita las peticiones por minuto.
 * Ante un 429 espera y reintenta antes de dejar que falle todo el trabajo.
 */
async function conReintentos<T>(fn: () => Promise<T>, intentos = 3): Promise<T> {
  let ultimo: unknown;
  for (let i = 0; i < intentos; i++) {
    try {
      return await fn();
    } catch (err) {
      ultimo = err;
      const es429 = err instanceof Error && /\b429\b/.test(err.message);
      if (!es429 || i === intentos - 1) throw err;
      await esperar(15_000 * (i + 1));
    }
  }
  throw ultimo;
}

/**
 * Voz local con espeak-ng. El texto entra por stdin, nunca por la linea de
 * comandos, asi que ni la longitud ni los caracteres raros dan problemas.
 */
export function vozLocal(
  texto: string,
  destino: string,
  voz = env.VOZ_LOCAL_VOZ,
  velocidad = env.VOZ_LOCAL_VELOCIDAD,
) {
  const limpio = limpiarMarcas(texto);
  return new Promise<void>((resolve, reject) => {
    // Solo letras, digitos, guiones, "+" y ":" (piper:xxx): nada mas llega al argumento.
    if (!/^[a-z0-9+_:.-]{1,40}$/i.test(voz)) return reject(new Error(`Voz local invalida: ${voz}`));

    const esPiper = voz.startsWith("piper:");
    const p = esPiper
      ? spawn(PIPER_BIN, [
          "--model", join(PIPER_VOCES, `${voz.slice(6)}.onnx`),
          // 1,0 es el ritmo natural del modelo; 150 ppm equivale a eso.
          "--length_scale", (150 / velocidad).toFixed(2),
          "--output_file", destino,
        ])
      : spawn("espeak-ng", ["-v", voz, "-s", String(velocidad), "-p", "45", "-a", "170", "--stdin", "-w", destino]);

    let errores = "";
    p.stderr.on("data", (d) => (errores = (errores + d).slice(-1000)));
    p.on("error", () =>
      reject(new Error(esPiper ? "Piper no esta instalado (PIPER_BIN)" : "espeak-ng no esta instalado")),
    );
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${esPiper ? "piper" : "espeak-ng"} termino con codigo ${code}: ${errores}`)),
    );
    p.stdin.on("error", () => {});
    p.stdin.end(limpio + "\n");
  });
}

/** Una llamada de sintesis; devuelve el WAV ya escrito o lanza el error de la API. */
async function pedirVozGemini(modelo: string, voz: string, texto: string, destino: string, idioma = "es") {
  // El estilo va delante como indicacion, igual que en los ejemplos de Google
  // ("Say cheerfully: ..."), y el texto que se lee va limpio de corchetes.
  const { directiva, limpio } = estiloDesdeMarcas(texto);
  const instruccion = `${instruccionDeVoz(idioma)}${directiva ? `, ${directiva}` : ""}`;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${instruccion}:\n${limpio}` }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } },
        },
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );
  const data = await leerJSON(res);
  if (!res.ok) {
    const detalle = data?.error?.message ?? "";
    const err = new Error(`Gemini TTS ${res.status}: ${detalle}`);
    // Marca los fallos de "ese modelo no existe" para poder reintentar con otro.
    (err as { modeloMal?: boolean }).modeloMal =
      res.status === 404 || /not found|is not supported|no compatible/i.test(detalle);
    throw err;
  }

  const candidato = data.candidates?.[0];
  const parte = candidato?.content?.parts?.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data);
  if (!parte) {
    const motivo = candidato?.finishReason ?? data?.promptFeedback?.blockReason ?? "sin detalle";
    throw new Error(
      `Gemini TTS no devolvio audio (${motivo}). ` +
        "Suele pasar si el modelo elegido no es de voz o si el texto se bloqueo por contenido.",
    );
  }
  const rate = Number(parte.inlineData.mimeType?.match(/rate=(\d+)/)?.[1]) || 24000;
  await writeFile(destino, pcmAWav(Buffer.from(parte.inlineData.data, "base64"), rate));
}

export async function vozGemini(
  texto: string,
  destino: string,
  modelo = VOZ_GEMINI_POR_DEFECTO.modelo,
  voz = VOZ_GEMINI_POR_DEFECTO.nombre,
  idioma = "es",
) {
  if (!env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  if (!VOCES.gemini.includes(voz as (typeof VOCES.gemini)[number])) {
    // Una voz local colada en una configuracion de Gemini: se usa la de serie.
    voz = VOZ_GEMINI_POR_DEFECTO.nombre;
  }

  // Una sola peticion de voz a la vez: dos a la vez gastan cuota en paralelo,
  // disparan el limite por minuto y no aceleran nada, porque el cuello de
  // botella es el propio proveedor.
  await conReintentos(() =>
    enFila("voz:gemini", async () => {
    const elegido = await modeloVozGemini(modelo);
    try {
      await pedirVozGemini(elegido, voz, texto, destino, idioma);
    } catch (err) {
      if (!(err as { modeloMal?: boolean }).modeloMal) throw err;

      // El modelo no vale: se vuelve a preguntar a la API y se prueba con otro.
      const disponibles = await modelosVozGemini(true).catch(() => [] as string[]);
      const alternativo = disponibles.find((n) => n !== elegido);
      if (!alternativo) {
        throw new Error(
          `El modelo de voz "${elegido}" no existe para tu clave de Gemini. ` +
            (disponibles.length
              ? `Los que tienes son: ${disponibles.join(", ")}. Ponlo en GEMINI_MODELO_VOZ.`
              : "Tu clave no tiene ningun modelo de voz (tts) disponible: revisa el proyecto de Google AI Studio."),
        );
      }
      await pedirVozGemini(alternativo, voz, texto, destino, idioma);
    }
    }, { separacionMs: 250 }),
  );
}

export async function vozOpenAI(
  texto: string,
  destino: string,
  modelo = env.OPENAI_MODELO_VOZ,
  voz = env.OPENAI_VOZ,
  idioma = "es",
) {
  if (!env.OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY");
  await conReintentos(() =>
    enFila("voz:openai", async () => {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: modelo,
        voice: voz,
        input: limpiarMarcas(texto),
        response_format: "mp3",
        instructions: instruccionDeVoz(idioma),
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
    await writeFile(destino, Buffer.from(await res.arrayBuffer()));
    }, { separacionMs: 250 }),
  );
}

/**
 * Genera el audio de una escena dentro de `dir` y devuelve el nombre del archivo.
 * ffmpeg lee ambos formatos, asi que la extension cambia con el proveedor.
 */
/**
 * Arregla configuraciones incoherentes antes de llamar a nadie: un proyecto
 * guardado con proveedor "gemini" y el modelo de la voz local pedia
 * `models/espeak-ng:generateContent`, que solo puede devolver un 404.
 */
export function normalizarVoz(config: unknown): VozConfig {
  const leido = VozSchema.safeParse(config);
  // Una configuracion rota (de un proyecto viejo o de una edicion a mano) no
  // debe tumbar el render con un volcado de validacion: se toma el proveedor
  // si se entiende y el resto se rellena con lo de serie.
  const voz: VozConfig = leido.success
    ? leido.data
    : (() => {
        const p = (config as { proveedor?: string } | null)?.proveedor;
        if (p === "gemini") return { ...VOZ_GEMINI_POR_DEFECTO };
        if (p === "openai") return { ...VOZ_OPENAI_POR_DEFECTO };
        return { ...VOZ_POR_DEFECTO };
      })();

  if (voz.proveedor === "local") return voz;

  const porDefecto = voz.proveedor === "gemini" ? VOZ_GEMINI_POR_DEFECTO : VOZ_OPENAI_POR_DEFECTO;
  const nombres: readonly string[] = VOCES[voz.proveedor];
  // El modelo de una voz local (o vacio) no sirve para un proveedor de IA.
  const modeloLocal = VOCES_LOCALES.some((v) => v.id === voz.modelo) || voz.modelo === "espeak-ng" || voz.modelo === "local";
  return {
    proveedor: voz.proveedor,
    modelo: modeloLocal || !voz.modelo.trim() ? porDefecto.modelo : voz.modelo,
    nombre: nombres.includes(voz.nombre) ? voz.nombre : porDefecto.nombre,
  };
}

export async function generarVoz(
  config: unknown,
  texto: string,
  dir: string,
  indice: number,
  /** Idioma del texto: decide cómo se le pide el tono a la voz de IA. */
  idioma = "es",
): Promise<string> {
  const voz = normalizarVoz(config);
  const nombre = voz.proveedor === "openai" ? `voz${indice}.mp3` : `voz${indice}.wav`;
  const destino = join(dir, nombre);

  if (voz.proveedor === "local") await vozLocal(texto, destino, voz.nombre);
  else if (voz.proveedor === "openai") await vozOpenAI(texto, destino, voz.modelo, voz.nombre, idioma);
  else await vozGemini(texto, destino, voz.modelo, voz.nombre, idioma);

  return nombre;
}

// ------------------------------------------------------ Reparto de voces

/** Qué proveedores de voz se pueden usar de verdad: los que tienen clave. */
export const vocesDisponibles = () => ({
  local: true,
  gemini: Boolean(env.GEMINI_API_KEY),
  openai: Boolean(env.OPENAI_API_KEY),
});

/**
 * El carácter de cada voz de IA, que es lo que las distingue de verdad.
 * Sale de cómo suenan, no de lo que dice el catálogo del proveedor.
 */
const CARACTER: Record<string, string[]> = {
  Kore: ["firme", "seria", "seca"],
  Orus: ["firme", "serio", "seco"],
  Puck: ["ironico", "juguetón", "burlón", "alegre"],
  Charon: ["grave", "calmado", "cansado", "didactico"],
  Fenrir: ["nervioso", "intenso", "enfadado"],
  Aoede: ["calida", "suave", "cercana"],
  Leda: ["joven", "dulce", "timida"],
  Zephyr: ["brillante", "animada", "clara"],
  coral: ["calida", "cercana"],
  nova: ["joven", "clara"],
  shimmer: ["brillante", "suave"],
  sage: ["serena", "didactica"],
  echo: ["grave", "cansado"],
  onyx: ["grave", "profundo"],
  fable: ["ironico", "narrador"],
  alloy: ["neutra"],
};

const sinTildes = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Si la descripción habla de ese rasgo. Se compara por la raíz porque el
 * género de la palabra cambia y "irónica" no contiene "irónico".
 */
function tieneRasgo(descripcion: string, rasgo: string): boolean {
  const raiz = rasgo.length >= 5 ? rasgo.slice(0, -1) : rasgo;
  return descripcion.includes(sinTildes(raiz));
}

/** El género que pide una descripción ("mujer mayor" → femenino). */
function generoDe(texto: string): Genero {
  const t = sinTildes(texto);
  if (/\b(mujer|femenin|chica|señora|ella|madre|abuela|hermana)\b/.test(t)) return "femenino";
  if (/\b(hombre|masculin|chico|señor|el|padre|abuelo|hermano)\b/.test(t)) return "masculino";
  return "desconocido";
}

export type VozRepartida = {
  indice: number;
  config: VozConfig;
  /** Por qué esa voz, para que se vea y se pueda cambiar. */
  motivo: string;
};

/**
 * Reparte una voz distinta a cada hablante.
 *
 * Elegir voces a mano para dos o tres personajes es tedioso, y el error
 * habitual —dejar la misma para todos— hace que el diálogo suene a una
 * persona hablando sola. Aquí se reparte solo: se usa la descripción que
 * propone quien escribió el diálogo ("firme", "cálida", "joven"), se respeta
 * el género que pida el papel, y **nunca se repite una voz** mientras queden
 * libres.
 *
 * Con clave de Gemini o de OpenAI usa sus voces, que es lo que de verdad
 * suena a personas distintas; sin clave, reparte las locales.
 */
export async function repartirVoces(
  hablantes: { nombre: string; papel?: string; voz?: string }[],
  o: { proveedor?: "auto" | "local" | "gemini" | "openai"; idioma?: "es" | "en" } = {},
): Promise<VozRepartida[]> {
  const hay = vocesDisponibles();
  const pedido = o.proveedor ?? "auto";
  const proveedor: VozConfig["proveedor"] =
    pedido !== "auto" && (pedido === "local" || hay[pedido])
      ? pedido
      : hay.gemini
        ? "gemini"
        : hay.openai
          ? "openai"
          : "local";

  const idioma = o.idioma === "en" ? "en" : "es";
  const base =
    proveedor === "gemini" ? VOZ_GEMINI_POR_DEFECTO : proveedor === "openai" ? VOZ_OPENAI_POR_DEFECTO : VOZ_POR_DEFECTO;

  // El repertorio: las de IA con su carácter, las locales con su calidad.
  const repertorio =
    proveedor === "local"
      ? (await vocesLocalesDisponibles())
          .filter((v) => v.idioma === idioma)
          .sort((a, b) => b.calidad - a.calidad)
          .map((v) => ({ nombre: v.id, etiqueta: v.nombre, genero: v.genero, caracter: [] as string[] }))
      : [...VOCES[proveedor]].map((n) => ({
          nombre: n,
          etiqueta: n,
          genero: GENERO_VOZ_IA[n] ?? "desconocido",
          caracter: CARACTER[n] ?? [],
        }));

  if (!repertorio.length) {
    // Sin voces de ese idioma (pasa con el inglés en una máquina pelada).
    return hablantes.map((_, indice) => ({ indice, config: base, motivo: "la voz de siempre: no hay otras" }));
  }

  const usadas = new Set<string>();
  return hablantes.map((h, indice) => {
    const descripcion = sinTildes([h.voz, h.papel].filter(Boolean).join(" "));
    const generoPedido = generoDe([h.voz, h.papel, h.nombre].filter(Boolean).join(" "));

    const puntuar = (v: (typeof repertorio)[number]) => {
      let puntos = 0;
      if (usadas.has(v.nombre)) puntos -= 100;
      if (generoPedido !== "desconocido" && v.genero === generoPedido) puntos += 10;
      // Alternar géneros cuando nadie pidió uno: dos voces del mismo timbre
      // se confunden aunque sean distintas.
      if (generoPedido === "desconocido" && v.genero === (indice % 2 === 0 ? "femenino" : "masculino")) puntos += 4;
      for (const c of v.caracter) if (tieneRasgo(descripcion, c)) puntos += 8;
      return puntos;
    };

    const elegida = [...repertorio].sort((a, b) => puntuar(b) - puntuar(a))[0];
    usadas.add(elegida.nombre);
    const rasgo = elegida.caracter.find((c) => tieneRasgo(descripcion, c));
    return {
      indice,
      config: { ...base, nombre: elegida.nombre },
      motivo: [elegida.etiqueta, rasgo ?? (elegida.genero !== "desconocido" ? elegida.genero : "")]
        .filter(Boolean)
        .join(" · "),
    };
  });
}
