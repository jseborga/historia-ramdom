import { spawn } from "node:child_process";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../env.js";
import { leerJSON } from "../util/http.js";

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
export type VozLocal = {
  id: string;
  nombre: string;
  motor: "espeak" | "mbrola" | "piper";
  idioma: "es" | "en";
  calidad: 1 | 2 | 3;
};

export const VOCES_LOCALES: VozLocal[] = [
  { id: "es-419", nombre: "espeak · espanol latino (robotica)", motor: "espeak", idioma: "es", calidad: 1 },
  { id: "es", nombre: "espeak · espanol de Espana (robotica)", motor: "espeak", idioma: "es", calidad: 1 },
  { id: "en-us", nombre: "espeak · ingles EE. UU. (robotica)", motor: "espeak", idioma: "en", calidad: 1 },
  { id: "mb-mx1", nombre: "MBROLA · mexicano 1 (natural)", motor: "mbrola", idioma: "es", calidad: 2 },
  { id: "mb-mx2", nombre: "MBROLA · mexicano 2 (natural)", motor: "mbrola", idioma: "es", calidad: 2 },
  { id: "mb-vz1", nombre: "MBROLA · venezolano (natural)", motor: "mbrola", idioma: "es", calidad: 2 },
  { id: "mb-es1", nombre: "MBROLA · espanol 1 (natural)", motor: "mbrola", idioma: "es", calidad: 2 },
  { id: "mb-es2", nombre: "MBROLA · espanol 2 (natural)", motor: "mbrola", idioma: "es", calidad: 2 },
  { id: "piper:es_MX-claude-high", nombre: "Piper · mexicano, neural (la mejor)", motor: "piper", idioma: "es", calidad: 3 },
  { id: "piper:es_ES-davefx-medium", nombre: "Piper · espanol de Espana, neural", motor: "piper", idioma: "es", calidad: 3 },
];

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

/** La mejor voz local disponible, para usarla por defecto. */
export async function mejorVozLocal(idioma: "es" | "en" = "es"): Promise<string> {
  const lista = (await vocesLocalesDisponibles()).filter((v) => v.idioma === idioma);
  return lista.sort((a, b) => b.calidad - a.calidad)[0]?.id ?? env.VOZ_LOCAL_VOZ;
}

/** Indicaciones entre corchetes ([pausa], [susurrando]...) que solo entiende Gemini. */
export const limpiarMarcas = (t: string) => t.replace(/\[[^\]\n]{1,40}\]/g, " ").replace(/\s+/g, " ").trim();

/** Voces disponibles; sirven para poblar el selector del frontend. */
export const VOCES = {
  local: VOCES_LOCALES.map((v) => v.id),
  gemini: ["Kore", "Puck", "Charon", "Fenrir", "Aoede", "Leda", "Orus", "Zephyr"],
  openai: ["coral", "alloy", "echo", "fable", "onyx", "nova", "shimmer", "sage"],
} as const;

const INSTRUCCION = "Voz calida, pausada y cercana, en espanol latinoamericano neutro.";

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

export async function vozGemini(
  texto: string,
  destino: string,
  modelo = VOZ_POR_DEFECTO.modelo,
  voz = VOZ_POR_DEFECTO.nombre,
) {
  if (!env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  await conReintentos(async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY! },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${INSTRUCCION} Las indicaciones entre corchetes son de tono y no se leen. Narra: ${texto}` }] }],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } },
          },
        }),
        signal: AbortSignal.timeout(120_000),
      },
    );
    const data = await leerJSON(res);
    if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${data?.error?.message ?? ""}`);
    const parte = data.candidates?.[0]?.content?.parts?.find(
      (p: { inlineData?: { data?: string } }) => p.inlineData?.data,
    );
    if (!parte) throw new Error("Gemini TTS no devolvio audio");
    const rate = Number(parte.inlineData.mimeType?.match(/rate=(\d+)/)?.[1]) || 24000;
    await writeFile(destino, pcmAWav(Buffer.from(parte.inlineData.data, "base64"), rate));
  });
}

export async function vozOpenAI(
  texto: string,
  destino: string,
  modelo = env.OPENAI_MODELO_VOZ,
  voz = env.OPENAI_VOZ,
) {
  if (!env.OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY");
  await conReintentos(async () => {
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
        instructions: INSTRUCCION,
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
    await writeFile(destino, Buffer.from(await res.arrayBuffer()));
  });
}

/**
 * Genera el audio de una escena dentro de `dir` y devuelve el nombre del archivo.
 * ffmpeg lee ambos formatos, asi que la extension cambia con el proveedor.
 */
export async function generarVoz(
  config: unknown,
  texto: string,
  dir: string,
  indice: number,
): Promise<string> {
  const voz = VozSchema.parse(config);
  const nombre = voz.proveedor === "openai" ? `voz${indice}.mp3` : `voz${indice}.wav`;
  const destino = join(dir, nombre);

  if (voz.proveedor === "local") await vozLocal(texto, destino, voz.nombre);
  else if (voz.proveedor === "openai") await vozOpenAI(texto, destino, voz.modelo, voz.nombre);
  else await vozGemini(texto, destino, voz.modelo, voz.nombre);

  return nombre;
}
