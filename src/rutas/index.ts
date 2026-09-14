import type { FastifyInstance } from "fastify";
import { rutasCatalogo } from "./catalogo.js";
import { rutasSeries } from "./series.js";
import { rutasHistorias } from "./historias.js";
import { rutasTikTok } from "./tiktok.js";
import { rutasBanco } from "./banco.js";
import { rutasProyectos } from "./proyectos.js";
import { rutasMusica } from "./musica.js";
import { rutasMedios } from "./medios.js";
import { rutasDialogos } from "./dialogos.js";

export async function registrarRutas(app: FastifyInstance) {
  await rutasCatalogo(app);
  await rutasSeries(app);
  await rutasHistorias(app);
  await rutasTikTok(app);
  await rutasBanco(app);
  await rutasProyectos(app);
  await rutasMusica(app);
  await rutasMedios(app);
  await rutasDialogos(app);
}
