import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { env } from "../env.js";
import { leerJSON } from "../util/http.js";

export const VozSchema = z.object({
  proveedor: z.enum(["gemini", "openai"]),
  modelo: z.string().min(1).max(80),
  nombre: z.string().min(1).max(40),
});
export type VozConfig = z.infer<typeof VozSchema>;

/** Los modelos de voz se configuran en el entorno (Google AI Studio los renueva). */
export const VOZ_POR_DEFECTO: VozConfig = {
  proveedor: "gemini",
  modelo: env.GEMINI_MODELO_VOZ,
  nombre: env.GEMINI_VOZ,
};

export const VOZ_OPENAI_POR_DEFECTO: VozConfig = {
  proveedor: "openai",
  modelo: env.OPENAI_MODELO_VOZ,
  nombre: env.OPENAI_VOZ,
};

/** Voces disponibles; sirven para poblar el selector del frontend. */
export const VOCES = {
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
          contents: [{ parts: [{ text: `${INSTRUCCION} Narra: ${texto}` }] }],
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
        input: texto,
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

  if (voz.proveedor === "openai") await vozOpenAI(texto, destino, voz.modelo, voz.nombre);
  else await vozGemini(texto, destino, voz.modelo, voz.nombre);

  return nombre;
}
