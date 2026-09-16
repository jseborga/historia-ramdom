import { mkdir, unlink, writeFile } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listarMusica, rutaMusica, rutaMusicaSegura, nombreMusicaLibre } from "../almacen.js";
import { tieneAudio, duracionAudio } from "../render/ffmpeg.js";
import { MAX_AUDIO_BYTES, MAX_AUDIO_MB } from "../env.js";
import { importarSunoABiblioteca, enlaceSuno } from "../servicios/suno.js";
import {
  INSTRUCCIONES_SUNO,
  ORIGENES,
  RITMOS,
  RemixSchema,
  generarRemix,
  remixATexto,
} from "../servicios/remix.js";

const EXTENSIONES = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;

/** Lo que se pide para hacer un remix. El origen de la letra no es opcional. */
const PeticionRemix = z.object({
  letra: z.string().max(20_000).default(""),
  /** "propia" = se puede reescribir. "ajena" = solo el tema, letra nueva. */
  origen: z.enum(ORIGENES),
  tema: z.string().max(300).default(""),
  titulo: z.string().max(120).default(""),
  ritmos: z.array(z.string().max(40)).min(1).max(6),
  viral: z.boolean().default(true),
  notas: z.string().max(600).default(""),
  idioma: z.enum(["es", "en"]).default("es"),
  region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
  modismos: z.boolean().default(true),
  motor: z.string().max(40).nullable().default(null),
  modelo: z.string().max(80).nullable().default(null),
});

/** Biblioteca de música compartida (DATA_DIR/musica): series, historias y editor. */
export async function rutasMusica(app: FastifyInstance) {
  app.get("/api/musica", async () => {
    const pistas = await listarMusica();
    return pistas.map((archivo) => ({ archivo, enlace: enlaceSuno(archivo) }));
  });

  /**
   * Añade a la biblioteca una canción de Suno a partir de su enlace. Solo se
   * descarga desde el CDN de Suno, con tope de tamaño y comprobación con ffprobe.
   */
  app.post("/api/musica/enlace", async (req, reply) => {
    const { url } = z.object({ url: z.string().min(10).max(400) }).parse(req.body);
    try {
      const r = await importarSunoABiblioteca(url);
      return reply.code(r.nueva ? 201 : 200).send({ ...r, musica: await listarMusica() });
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "No se pudo importar" });
    }
  });

  /** Los ritmos a los que se puede llevar una canción, y cómo usarlos en Suno. */
  app.get("/api/remix/ritmos", async () => ({
    ritmos: RITMOS.map((r) => ({ id: r.id, nombre: r.nombre, estilo: r.estilo, bpm: r.bpm })),
    instrucciones: INSTRUCCIONES_SUNO,
  }));

  /**
   * Escribe la canción en otros ritmos, con las cajas de Suno listas.
   *
   * Con `origen: "ajena"` no se reescribe nada: se toma el tema y se escribe
   * una canción original, y la respuesta trae en `calcos` las frases del
   * original que se hayan colado, si alguna se coló.
   */
  app.post("/api/remix", async (req, reply) => {
    const p = PeticionRemix.parse(req.body);
    if (!p.letra.trim() && !p.tema.trim()) {
      return reply.code(400).send({ error: "Pega la letra o escribe de que va la cancion" });
    }
    try {
      return await generarRemix(p);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "No se pudo escribir el remix" });
    }
  });

  /** El remix entero en un .txt, para llevárselo a Suno sin la pantalla delante. */
  app.post("/api/remix/texto", async (req, reply) => {
    const { remix, titulo } = z
      .object({ remix: RemixSchema, titulo: z.string().max(120).default("Remix") })
      .parse(req.body);
    const limpio = titulo.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "remix";
    reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${limpio}-suno.txt"`);
    return reply.send(remixATexto(remix, titulo) + "\n");
  });

  /**
   * Sube una canción propia a la biblioteca. Es la salida cuando Suno no deja
   * descargar la pista: se baja a mano desde Suno y se sube aquí. El nombre lo
   * limpia el servidor y el contenido se comprueba con ffprobe antes de darlo
   * por bueno.
   */
  app.post("/api/musica/subir", async (req, reply) => {
    const subido = await req.file({ limits: { fileSize: MAX_AUDIO_BYTES } });
    if (!subido) return reply.code(400).send({ error: "No llego ningun archivo" });
    if (!EXTENSIONES.test(subido.filename ?? "")) {
      return reply.code(415).send({ error: "Formato no admitido: usa mp3, m4a, wav, ogg o aac" });
    }
    const extension = (EXTENSIONES.exec(subido.filename)?.[1] ?? "mp3").toLowerCase();
    const datos = await subido.toBuffer().catch(() => null);
    if (!datos) return reply.code(413).send({ error: `El archivo supera los ${MAX_AUDIO_MB} MB` });

    await mkdir(rutaMusica(), { recursive: true });
    const nombre = await nombreMusicaLibre(
      (subido.filename ?? "cancion").replace(EXTENSIONES, ""),
      extension,
    );
    const destino = rutaMusicaSegura(nombre);
    await writeFile(destino, datos);
    if (!(await tieneAudio(destino))) {
      await unlink(destino).catch(() => {});
      return reply.code(415).send({ error: "El archivo no contiene ninguna pista de audio" });
    }
    const duracion = await duracionAudio(destino).catch(() => null);
    return reply.code(201).send({ archivo: nombre, duracion, musica: await listarMusica() });
  });
}
