import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { listarMusica } from "../almacen.js";
import { importarSunoABiblioteca, enlaceSuno } from "../servicios/suno.js";

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
}
