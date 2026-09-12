import { createReadStream } from "node:fs";
import { stat, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { rutaVideo, crearCarpetaProyecto, rutaSubidaSegura, rutaMusicaSegura, listarMusica } from "../almacen.js";
import { PRESETS, MAX_DURACION_SEG } from "../render/presets.js";
import { MAX_AUDIO_BYTES, MAX_AUDIO_MB } from "../env.js";
import { tieneAudio, duracionAudio } from "../render/ffmpeg.js";
import { fuentesDisponibles, archivoDeFuente } from "../render/fuentes.js";
import { GuionSchema, generarKeywords, escribirNarracion, guionComoNarracion } from "../servicios/guion.js";
import { ensamblarProyecto } from "../servicios/ensamblar.js";
import { elegirClips } from "../servicios/clips.js";
import {
  ProyectoSchema,
  pistasDesdeGuion,
  desdeEscenasAntiguas,
  esModeloAntiguo,
  clipVacio,
  textosDesdeNarracion,
  duracionVideo,
  duracionProyecto,
  creditosDeProyecto,
  descripcionDeProyecto,
  MusicaCapaSchema,
  VOZ_IA_POR_DEFECTO,
  type ClipPista,
  type RotuloPista,
  type VozPista,
} from "../servicios/proyecto.js";
import { generarNarracion } from "../servicios/narracion.js";
import type { EscenaPreparada } from "../servicios/clips.js";
import { encolarProyecto, encolarVideoclip, encolarVariante, encolarCanciones } from "../cola/cola.js";
import { importarSunoAProyecto, creditoMusica } from "../servicios/suno.js";
import {
  momentosDeProyecto,
  esLetra,
  guardarLetra,
  sugerirLineamientos,
  promptsDeLetra,
} from "../servicios/videoclip.js";
import { creditosDePartes, MAX_CANCIONES, CRUCE_POR_DEFECTO } from "../servicios/mezcla.js";

const idParam = z.object({ id: z.string().uuid() });

const EXTENSIONES = /\.(mp3|m4a|wav|ogg|aac|flac)$/i;

/** Una canción de la lista: enlace de Suno, pista de la biblioteca o archivo ya subido. */
const FuenteSchema = z.object({
  tipo: z.enum(["suno", "biblioteca", "proyecto"]),
  valor: z.string().min(1).max(400),
  titulo: z.string().max(120).optional(),
  /** Letra de esta canción; con ella cada tema tiene sus propios tramos. */
  letra: z.string().max(20_000).optional(),
});

const TIPOS_AUDIO: Record<string, string> = {
  mp3: "audio/mpeg", m4a: "audio/mp4", wav: "audio/wav",
  ogg: "audio/ogg", aac: "audio/aac", flac: "audio/flac",
};

/** Créditos de la música: la lista de canciones si las hay, o el nombre del archivo. */
function creditosMusica(capa: unknown): string | null {
  const musica = MusicaCapaSchema.safeParse(capa ?? {});
  if (!musica.success) return null;
  return musica.data.partes.length
    ? creditosDePartes(musica.data.partes)
    : creditoMusica(musica.data.archivo);
}

const tipoAudio = (nombre: string) =>
  TIPOS_AUDIO[(EXTENSIONES.exec(nombre)?.[1] ?? "").toLowerCase()] ?? "application/octet-stream";

/**
 * Recibe un audio subido y lo deja en la carpeta del proyecto. El nombre lo
 * pone el servidor, la extension se comprueba contra una lista y el contenido
 * tiene que tener pista de audio de verdad: lo dice ffprobe, no el navegador.
 */
async function recibirAudio(
  req: FastifyRequest,
  proyectoId: string,
): Promise<
  | { ok: false; codigo: number; mensaje: string }
  | { ok: true; archivo: string; destino: string; duracion: number | null }
> {
  const fallo = (codigo: number, mensaje: string) => ({ ok: false as const, codigo, mensaje });
  const subido = await req.file({ limits: { fileSize: MAX_AUDIO_BYTES } });
  if (!subido) return fallo(400, "No llego ningun archivo");
  if (!EXTENSIONES.test(subido.filename ?? "")) {
    return fallo(415, "Formato no admitido: usa mp3, m4a, wav, ogg o aac");
  }
  const extension = (EXTENSIONES.exec(subido.filename)?.[1] ?? "mp3").toLowerCase();
  const nombre = `${randomUUID()}.${extension}`;
  const destino = rutaSubidaSegura(proyectoId, nombre);
  const datos = await subido.toBuffer().catch(() => null);
  if (!datos) return fallo(413, `El archivo supera los ${MAX_AUDIO_MB} MB`);

  await crearCarpetaProyecto(proyectoId);
  await writeFile(destino, datos);
  if (!(await tieneAudio(destino))) {
    await unlink(destino).catch(() => {});
    return fallo(415, "El archivo no contiene ninguna pista de audio");
  }
  const duracion = await duracionAudio(destino).catch(() => null);
  return { ok: true, archivo: nombre, destino, duracion };
}

/** Lee las pistas de la fila, convirtiendo proyectos del modelo antiguo. */
function pistasDe(p: { escenas: unknown; textos: unknown }) {
  const escenas = Array.isArray(p.escenas) ? p.escenas : [];
  if (esModeloAntiguo(escenas)) return desdeEscenasAntiguas(escenas);
  return {
    video: escenas as ClipPista[],
    textos: (Array.isArray(p.textos) ? p.textos : []) as RotuloPista[],
  };
}

/**
 * Sirve un archivo con soporte de Range (el reproductor salta sin bajarlo
 * entero). Con `descarga` lo manda como adjunto.
 */
async function servir(
  req: FastifyRequest,
  reply: FastifyReply,
  ruta: string,
  tipo: string,
  descarga?: string,
) {
  const info = await stat(ruta).catch(() => null);
  if (!info) return reply.code(404).send({ error: "El archivo ya no esta en el servidor" });

  reply.header("Content-Type", tipo).header("Accept-Ranges", "bytes");
  if (descarga) reply.header("Content-Disposition", `attachment; filename="${descarga}"`);

  const rango = descarga ? null : /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!rango) {
    reply.header("Content-Length", info.size);
    return reply.send(createReadStream(ruta));
  }
  const inicio = rango[1] ? Number(rango[1]) : 0;
  const fin = rango[2] ? Math.min(Number(rango[2]), info.size - 1) : info.size - 1;
  if (inicio >= info.size || fin < inicio) {
    return reply.code(416).header("Content-Range", `bytes */${info.size}`).send({ error: "Rango invalido" });
  }
  reply
    .code(206)
    .header("Content-Range", `bytes ${inicio}-${fin}/${info.size}`)
    .header("Content-Length", fin - inicio + 1);
  return reply.send(createReadStream(ruta, { start: inicio, end: fin }));
}

export async function rutasProyectos(app: FastifyInstance) {
  app.get("/api/presets", async () => PRESETS);

  app.get("/api/fuentes", async () =>
    (await fuentesDisponibles()).map(({ id, nombre, estilo }) => ({ id, nombre, estilo })),
  );

  app.get("/api/fuentes/:id", async (req, reply) => {
    const { id } = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/) }).parse(req.params);
    const archivo = await archivoDeFuente(id);
    if (!archivo) return reply.code(404).send({ error: "Fuente desconocida" });
    reply.header("Cache-Control", "public, max-age=604800");
    return servir(req, reply, archivo, "font/ttf");
  });

  app.get("/api/proyectos", async () =>
    db.proyecto.findMany({
      orderBy: { editadoEn: "desc" },
      take: 100,
      select: {
        id: true, nombre: true, tipo: true, formato: true, estado: true, archivo: true,
        descripcion: true, duracionSeg: true, error: true, historiaId: true, editadoEn: true,
        _count: { select: { variantes: true } },
      },
    }),
  );

  app.get("/api/proyectos/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({
      where: { id },
      include: { variantes: { orderBy: { creadaEn: "asc" } } },
    });
    if (!p) return reply.code(404).send({ error: "No encontrado" });
    const { video, textos } = pistasDe(p);
    const voz = (p.voz ?? {}) as Partial<VozPista>;
    return {
      ...p,
      escenas: undefined,
      video,
      textos,
      voz: { modo: "servidor", texto: "", config: VOZ_IA_POR_DEFECTO, archivo: null,
             duracion: null, inicio: 0, huella: null, ...voz },
      // El analisis de la letra se devuelve ya validado, o null si no lo hay.
      letra: esLetra(p.letra),
      musicaDisponible: await listarMusica(),
      fuentes: await fuentesDisponibles(),
    };
  });

  /**
   * Crea un proyecto. Desde una historia: clips en secuencia, un rotulo por
   * escena colocado sobre su clip, y la narracion completa en la pista de voz.
   */
  app.post("/api/proyectos", async (req, reply) => {
    const { historiaId, nombre, formato } = z
      .object({
        historiaId: z.string().uuid().nullable().default(null),
        nombre: z.string().min(1).max(120).optional(),
        formato: z.string().max(40).optional(),
      })
      .parse(req.body ?? {});

    let video: ClipPista[] = [clipVacio(), clipVacio(), clipVacio()];
    let textos: RotuloPista[] = [];
    let narracion = "";
    let titulo = nombre ?? "Proyecto sin titulo";

    if (historiaId) {
      const h = await db.historia.findUnique({ where: { id: historiaId } });
      if (!h) return reply.code(404).send({ error: "La historia no existe" });
      const guion = GuionSchema.safeParse(h.guion);
      if (!guion.success) return reply.code(409).send({ error: "La historia todavia no tiene guion" });
      const preparadas = (h.escenas as EscenaPreparada[] | null) ?? [];
      const pistas = pistasDesdeGuion(guion.data, preparadas.map((e) => e?.clip ?? null));
      video = pistas.video;
      textos = pistas.textos;
      narracion = pistas.narracion;
      titulo = nombre ?? guion.data.titulo;
    }

    const datos = ProyectoSchema.parse({
      nombre: titulo,
      formato: formato ?? "tiktok",
      video,
      textos,
      voz: { modo: "servidor", texto: narracion, config: VOZ_IA_POR_DEFECTO },
      musica: {},
    });
    const proyecto = await db.proyecto.create({
      data: {
        historiaId, nombre: datos.nombre, formato: datos.formato,
        escenas: datos.video, textos: datos.textos, voz: datos.voz, musica: datos.musica,
      },
    });
    await crearCarpetaProyecto(proyecto.id);
    return reply.code(201).send(proyecto);
  });

  /** Guarda las tres pistas. El editor manda el proyecto entero. */
  app.put("/api/proyectos/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    const d = ProyectoSchema.parse(req.body);
    return db.proyecto.update({
      where: { id },
      data: { nombre: d.nombre, formato: d.formato, escenas: d.video, textos: d.textos, voz: d.voz, musica: d.musica },
    });
  });

  app.delete("/api/proyectos/:id", async (req) => {
    const { id } = idParam.parse(req.params);
    await db.proyecto.delete({ where: { id } });
    return { ok: true };
  });

  /**
   * Genera la narracion AHORA con una sola voz y devuelve su duracion real.
   * Con la voz local tarda un segundo; es lo que permite sincronizar el resto
   * antes de renderizar nada.
   */
  app.post("/api/proyectos/:id/voz", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { voz } = z.object({ voz: ProyectoSchema.shape.voz }).parse(req.body);
    if (voz.modo !== "servidor") return reply.code(400).send({ error: "Elige 'voz del servidor'" });
    const r = await generarNarracion(id, voz);
    const nueva: VozPista = { ...voz, ...r };
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    await db.proyecto.update({ where: { id }, data: { voz: { ...(p.voz as object), ...nueva } } });
    return nueva;
  });

  /** La narracion para la vista previa, con Range. */
  app.get("/api/proyectos/:id/voz", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    const voz = p?.voz as VozPista | null;
    if (!voz?.archivo) return reply.code(404).send({ error: "Todavia no hay narracion" });
    const tipo = voz.archivo.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";
    return servir(req, reply, rutaSubidaSegura(id, voz.archivo), tipo);
  });

  /**
   * Redacta la narracion corrida a partir del guion de la historia (o del
   * texto actual): "plano" es texto limpio bien puntuado; "expresivo" anade
   * marcas de tono entre corchetes para Gemini. "guion" la devuelve tal cual.
   */
  app.post("/api/proyectos/:id/narracion", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { estilo, texto, idioma, region, modismos } = z
      .object({
        estilo: z.enum(["plano", "expresivo", "guion"]).default("plano"),
        texto: z.string().max(20_000).optional(),
        idioma: z.enum(["es", "en"]).default("es"),
        region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
        modismos: z.boolean().default(true),
      })
      .parse(req.body ?? {});
    const p = await db.proyecto.findUniqueOrThrow({ where: { id }, include: { historia: true } });
    const guion = p.historia ? GuionSchema.safeParse(p.historia.guion) : null;
    const fuente = texto?.trim() || (guion?.success ? guionComoNarracion(guion.data) : ((p.voz as VozPista | null)?.texto ?? ""));
    if (!fuente.trim()) return reply.code(409).send({ error: "No hay guion ni texto del que partir" });
    if (estilo === "guion") return { narracion: fuente };
    return { narracion: await escribirNarracion(fuente, estilo, idioma, null, region, modismos) };
  });

  /** Ensambla el proyecto entero con la narracion al mando. */
  app.post("/api/proyectos/:id/ensamblar", async (req) => {
    const { id } = idParam.parse(req.params);
    const opciones = z
      .object({
        preferirLargos: z.boolean().default(true),
        ganchoSeg: z.number().min(2).max(10).default(4),
        lectura: z.enum(["frases", "bloques"]).default("frases"),
        animacion: z.enum(["fundido", "resaltar", "ninguna"]).default("fundido"),
      })
      .parse(req.body ?? {});
    return ensamblarProyecto(id, opciones);
  });

  /** Rotulos frase a frase repartidos sobre la narracion (o sobre los clips). */
  app.post("/api/proyectos/:id/textos-desde-voz", async (req) => {
    const { id } = idParam.parse(req.params);
    const { voz, video, lectura } = z
      .object({
        voz: ProyectoSchema.shape.voz,
        video: ProyectoSchema.shape.video,
        lectura: z.enum(["frases", "bloques"]).default("frases"),
      })
      .parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });
    return textosDesdeNarracion(voz, duracionVideo(video), lectura);
  });

  /**
   * Un clip parecido a cada texto: palabras clave visuales (LLM o heuristica)
   * y eleccion sin descargar. El cliente manda, por clip, el texto que le cae
   * encima en la linea de tiempo.
   */
  app.post("/api/proyectos/:id/clips-automaticos", async (req) => {
    const { id } = idParam.parse(req.params);
    const { escenas, soloVacias, idioma } = z
      .object({
        escenas: z.array(z.object({ id: z.string(), texto: z.string(), tieneClip: z.boolean() })).max(120),
        soloVacias: z.boolean().default(true),
        idioma: z.enum(["es", "en"]).default("es"),
      })
      .parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });

    const objetivo = escenas.filter((e) => e.texto.trim() && (!soloVacias || !e.tieneClip));
    if (!objetivo.length) return { clips: {}, keywords: {} };
    const keywords = await generarKeywords(objetivo.map((e) => e.texto), idioma);
    const elegidos = await elegirClips(keywords.map((k) => ({ keywords: k })), new Set());
    return {
      clips: Object.fromEntries(objetivo.map((e, i) => [e.id, elegidos[i]])),
      keywords: Object.fromEntries(objetivo.map((e, i) => [e.id, keywords[i]])),
    };
  });

  /** Sube voz o musica propia: nombre del servidor, extension, tamano y ffprobe. */
  app.post("/api/proyectos/:id/subir", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    await db.proyecto.findUniqueOrThrow({ where: { id } });

    const r = await recibirAudio(req, id);
    if (!r.ok) return reply.code(r.codigo).send({ error: r.mensaje });
    return reply.code(201).send({ archivo: r.archivo, duracion: r.duracion });
  });

  /**
   * Sube la cancion del proyecto y la deja puesta en la capa de musica. Es la
   * salida cuando Suno no deja descargar: se baja a mano y se sube aqui.
   */
  app.post("/api/proyectos/:id/musica-archivo", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });

    const r = await recibirAudio(req, id);
    if (!r.ok) return reply.code(r.codigo).send({ error: r.mensaje });

    const actual = (p.musica ?? {}) as { volumen?: number };
    const musica = {
      archivo: r.archivo,
      subida: true,
      // En un videoclip la cancion es el contenido: suena entera.
      volumen: p.tipo === "MUSICA" ? 1 : (actual.volumen ?? 0.25),
    };
    await db.proyecto.update({ where: { id }, data: { musica } });

    // En un videoclip que ya sabe que contar, la cancion es lo ultimo que
    // faltaba: el montaje arranca sin que haya que pedirlo aparte.
    const letra = esLetra(p.letra);
    const montando = p.tipo === "MUSICA" && Boolean(letra?.texto.trim() || letra?.lineamientos.trim());
    if (montando) {
      await db.proyecto.update({ where: { id }, data: { estado: "MONTAJE" } });
      await encolarVideoclip(id);
    }

    return reply.code(201).send({ ...musica, duracion: r.duracion, montando });
  });

  /**
   * Música de ambiente desde un enlace de Suno: el id se saca del enlace y se
   * descarga solo desde el CDN de Suno a la carpeta del proyecto.
   */
  app.post("/api/proyectos/:id/musica-enlace", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { url } = z.object({ url: z.string().min(10).max(400) }).parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });
    try {
      const r = await importarSunoAProyecto(id, url);
      return reply.code(201).send({ ...r, creditos: creditoMusica(r.archivo) });
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "No se pudo importar" });
    }
  });

  /**
   * Videoclip musical: el mismo editor, pero manda la cancion. Se crea el
   * proyecto con su musica (enlace de Suno o pista de la biblioteca) y el
   * montaje se hace en segundo plano, que implica analizar la letra y buscar
   * clips. Sin musica se crea igual y se sube el archivo despues.
   */
  app.post("/api/proyectos/musical", async (req, reply) => {
    const d = z
      .object({
        nombre: z.string().min(1).max(120).optional(),
        formato: z.string().max(40).optional(),
        /** Enlace de la cancion en Suno; se descarga a la carpeta del proyecto. */
        enlaceSuno: z.string().max(400).optional(),
        /** Varias canciones encadenadas, para un videoclip mas largo. */
        canciones: z.array(FuenteSchema).max(MAX_CANCIONES).optional(),
        cruce: z.number().min(0).max(10).optional(),
        /** Pista ya presente en la biblioteca (DATA_DIR/musica). */
        musica: z.string().max(200).optional(),
        letra: z.string().max(20_000).optional(),
        lineamientos: z.string().max(2000).optional(),
        instrumental: z.boolean().default(false),
        mostrarLetra: z.boolean().default(true),
        idioma: z.enum(["es", "en"]).default("es"),
        motor: z.string().max(40).nullable().default(null),
        modelo: z.string().max(80).nullable().default(null),
      })
      .parse(req.body ?? {});

    const lista = d.canciones ?? [];
    const conLetraPropia = lista.some((c) => c.letra?.trim());
    if (!d.instrumental && !d.letra?.trim() && !d.lineamientos?.trim() && !conLetraPropia) {
      return reply.code(400).send({ error: "Pega la letra, o marca instrumental y escribe los lineamientos" });
    }
    if (d.musica && !(await listarMusica()).includes(d.musica)) {
      return reply.code(404).send({ error: "Esa pista no esta en la biblioteca" });
    }

    const datos = ProyectoSchema.parse({
      nombre: d.nombre ?? "Videoclip sin titulo",
      formato: d.formato ?? "tiktok",
      video: [clipVacio()],
      textos: [],
      // Un videoclip no lleva narracion: la pista de voz nace apagada.
      voz: { modo: "ninguna", texto: "", config: null },
      musica: { archivo: d.musica ?? null, subida: false, volumen: 1 },
    });
    const proyecto = await db.proyecto.create({
      data: {
        nombre: datos.nombre,
        tipo: "MUSICA",
        formato: datos.formato,
        escenas: datos.video,
        textos: datos.textos,
        voz: datos.voz,
        musica: datos.musica,
      },
    });
    await crearCarpetaProyecto(proyecto.id);
    // La letra y los lineamientos se guardan YA, antes de montar nada: si el
    // montaje falla o la cancion llega despues, no se pierde lo escrito.
    const letra = await guardarLetra(proyecto.id, {
      letra: d.letra,
      lineamientos: d.lineamientos,
      instrumental: d.instrumental,
      mostrarLetra: d.mostrarLetra,
      titulo: d.nombre,
    });

    if (d.enlaceSuno) {
      try {
        const r = await importarSunoAProyecto(proyecto.id, d.enlaceSuno);
        await db.proyecto.update({
          where: { id: proyecto.id },
          data: { musica: { archivo: r.archivo, subida: true, volumen: 1 } },
        });
      } catch (err) {
        await db.proyecto.delete({ where: { id: proyecto.id } }).catch(() => {});
        return reply.code(422).send({ error: err instanceof Error ? err.message : "No se pudo importar la cancion" });
      }
    }

    // Con la cancion ya puesta se monta enseguida; si se va a subir un
    // archivo, el montaje arranca solo en cuanto llegue.
    // Con lista de canciones, un trabajo las encadena y monta encima; con una
    // sola, se monta directamente. Sin musica todavia, el montaje espera.
    const conMusica = Boolean(d.enlaceSuno || d.musica || lista.length);
    if (lista.length) {
      await db.proyecto.update({ where: { id: proyecto.id }, data: { estado: "MONTAJE" } });
      await encolarCanciones(proyecto.id, lista, d.cruce);
    } else if (conMusica) {
      await db.proyecto.update({ where: { id: proyecto.id }, data: { estado: "MONTAJE" } });
      await encolarVideoclip(proyecto.id, { idioma: d.idioma, motor: d.motor, modelo: d.modelo });
    }
    return reply.code(201).send({ ...proyecto, letra, montando: conMusica });
  });

  /** Vuelve a montar el videoclip (otra letra, otros lineamientos, otros clips). */
  app.post("/api/proyectos/:id/videoclip", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const o = z
      .object({
        letra: z.string().max(20_000).optional(),
        lineamientos: z.string().max(2000).optional(),
        instrumental: z.boolean().optional(),
        mostrarLetra: z.boolean().optional(),
        idioma: z.enum(["es", "en"]).default("es"),
        motor: z.string().max(40).nullable().default(null),
        modelo: z.string().max(80).nullable().default(null),
        reanalizar: z.boolean().default(false),
      })
      .parse(req.body ?? {});
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    const musica = (p.musica ?? {}) as { archivo?: string | null };
    if (!musica.archivo) {
      return reply.code(409).send({ error: "El proyecto no tiene musica todavia: añade un enlace de Suno o sube el archivo" });
    }
    if (p.tipo !== "MUSICA") await db.proyecto.update({ where: { id }, data: { tipo: "MUSICA" } });

    // Lo que llegue se guarda antes de montar, para que el proyecto conserve
    // la configuracion aunque el montaje falle.
    const letra = await guardarLetra(id, {
      letra: o.letra,
      lineamientos: o.lineamientos,
      instrumental: o.instrumental,
      mostrarLetra: o.mostrarLetra,
    });
    const partes = MusicaCapaSchema.parse(p.musica ?? {}).partes;
    if (!letra.texto.trim() && !letra.lineamientos.trim() && !partes.some((x) => x.letra.trim())) {
      return reply.code(409).send({
        error: letra.instrumental
          ? "Escribe los lineamientos: sin letra hay que decir que se debe ver"
          : "Pega la letra de la cancion, o marcala como instrumental y escribe los lineamientos",
      });
    }

    await db.proyecto.update({ where: { id }, data: { estado: "MONTAJE", error: null } });
    const job = await encolarVideoclip(id, { idioma: o.idioma, motor: o.motor, modelo: o.modelo, reanalizar: o.reanalizar });
    return reply.code(202).send({ encolada: true, jobId: job.id, letra });
  });

  /**
   * Encadena varias canciones en una sola pista y monta encima. Cada canción
   * puede traer su propia letra: así la segunda no hereda los tramos de la
   * primera. Va en segundo plano porque hay que descargarlas y mezclarlas.
   */
  app.post("/api/proyectos/:id/canciones", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { fuentes, cruce, montar } = z
      .object({
        fuentes: z.array(FuenteSchema).min(1).max(MAX_CANCIONES),
        /** Segundos de solape entre canciones; 0 = corte seco. */
        cruce: z.number().min(0).max(10).default(CRUCE_POR_DEFECTO),
        montar: z.boolean().default(true),
      })
      .parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });

    await db.proyecto.update({ where: { id }, data: { estado: "MONTAJE", error: null } });
    const job = await encolarCanciones(id, fuentes, cruce, montar);
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });

  /** Cambia el título o la letra de cada canción sin volver a mezclar el audio. */
  app.patch("/api/proyectos/:id/canciones", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { partes } = z
      .object({
        partes: z
          .array(z.object({ archivo: z.string().max(200), titulo: z.string().max(120).optional(), letra: z.string().max(20_000).optional() }))
          .max(MAX_CANCIONES),
      })
      .parse(req.body);
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    const musica = MusicaCapaSchema.parse(p.musica ?? {});

    const actualizadas = musica.partes.map((parte) => {
      const cambio = partes.find((x) => x.archivo === parte.archivo);
      return cambio ? { ...parte, titulo: cambio.titulo ?? parte.titulo, letra: cambio.letra ?? parte.letra } : parte;
    });
    await db.proyecto.update({ where: { id }, data: { musica: { ...musica, partes: actualizadas } } });

    // La letra del proyecto es la de todas las canciones seguidas.
    const conLetra = actualizadas.filter((x) => x.letra.trim());
    if (conLetra.length) {
      await guardarLetra(id, {
        letra: conLetra.map((x) => `[${x.titulo}]\n${x.letra.trim()}`).join("\n\n"),
        instrumental: false,
      });
    }
    return { partes: actualizadas };
  });

  /** La misma ayuda de IA, pero antes de que exista el proyecto. */
  app.post("/api/lineamientos", async (req, reply) => {
    const o = z
      .object({
        letra: z.string().max(20_000).optional(),
        lineamientos: z.string().max(2000).optional(),
        instrumental: z.boolean().optional(),
        titulo: z.string().max(120).optional(),
        idioma: z.enum(["es", "en"]).default("es"),
        motor: z.string().max(40).nullable().default(null),
        modelo: z.string().max(80).nullable().default(null),
      })
      .parse(req.body ?? {});
    try {
      return await sugerirLineamientos(o);
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "No se pudo proponer nada" });
    }
  });

  /**
   * Ayuda de IA para describir el videoclip: a partir de la letra (o de cuatro
   * palabras) propone ambiente, criterios de búsqueda en inglés y un prompt
   * largo para generar imágenes. No guarda nada: se revisa y se guarda aparte.
   */
  app.post("/api/proyectos/:id/lineamientos", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const o = z
      .object({
        letra: z.string().max(20_000).optional(),
        lineamientos: z.string().max(2000).optional(),
        instrumental: z.boolean().optional(),
        idioma: z.enum(["es", "en"]).default("es"),
        motor: z.string().max(40).nullable().default(null),
        modelo: z.string().max(80).nullable().default(null),
      })
      .parse(req.body ?? {});
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    const guardada = esLetra(p.letra);
    try {
      return await sugerirLineamientos({
        letra: o.letra ?? guardada?.texto ?? "",
        lineamientos: o.lineamientos ?? guardada?.lineamientos ?? "",
        instrumental: o.instrumental ?? guardada?.instrumental,
        titulo: guardada?.titulo || p.nombre,
        duracion: p.duracionSeg ?? undefined,
        idioma: o.idioma,
        motor: o.motor,
        modelo: o.modelo,
      });
    } catch (err) {
      return reply.code(422).send({ error: err instanceof Error ? err.message : "No se pudo proponer nada" });
    }
  });

  /** Los prompts de imagen de cada tramo, para llevarlos a un generador. */
  app.get("/api/proyectos/:id/prompts.txt", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    if (!p) return reply.code(404).send({ error: "No encontrado" });
    const letra = esLetra(p.letra);
    if (!letra?.secciones.length) {
      return reply.code(409).send({ error: "Todavia no hay tramos: monta el videoclip primero" });
    }
    const musica = MusicaCapaSchema.parse(p.musica ?? {});
    reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="videoclip-${p.id.slice(0, 8)}-prompts.txt"`);
    return reply.send(promptsDeLetra(letra, musica.partes) + "\n");
  });

  /** Guarda la letra y los lineamientos sin montar nada. */
  app.patch("/api/proyectos/:id/letra", async (req) => {
    const { id } = idParam.parse(req.params);
    const cambios = z
      .object({
        letra: z.string().max(20_000).optional(),
        lineamientos: z.string().max(2000).optional(),
        instrumental: z.boolean().optional(),
        mostrarLetra: z.boolean().optional(),
        titulo: z.string().max(120).optional(),
      })
      .parse(req.body ?? {});
    await db.proyecto.findUniqueOrThrow({ where: { id } });
    return guardarLetra(id, cambios);
  });

  /** La cancion del proyecto, para oirla en la vista previa antes de renderizar. */
  app.get("/api/proyectos/:id/musica", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    const musica = (p?.musica ?? {}) as { archivo?: string | null; subida?: boolean };
    if (!musica.archivo) return reply.code(404).send({ error: "El proyecto no tiene musica" });
    const ruta = musica.subida ? rutaSubidaSegura(id, musica.archivo) : rutaMusicaSegura(musica.archivo);
    return servir(req, reply, ruta, tipoAudio(musica.archivo));
  });

  /**
   * Los tramos con mas fuerza de la cancion, para cortar los 30 segundos que
   * van a redes. Sale del nivel de la propia musica y, si hay letra, del coro.
   */
  app.get("/api/proyectos/:id/momentos", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { ventana, cuantos } = z
      .object({
        ventana: z.coerce.number().min(5).max(120).default(30),
        cuantos: z.coerce.number().int().min(1).max(5).default(3),
      })
      .parse(req.query ?? {});
    await db.proyecto.findUniqueOrThrow({ where: { id } });
    try {
      return await momentosDeProyecto(id, ventana, cuantos);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : "No se pudo analizar la musica" });
    }
  });

  /** Cortes y formatos del montaje: la version completa, los 30 s del coro... */
  app.get("/api/proyectos/:id/variantes", async (req) => {
    const { id } = idParam.parse(req.params);
    return db.variante.findMany({ where: { proyectoId: id }, orderBy: { creadaEn: "asc" } });
  });

  app.post("/api/proyectos/:id/variantes", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const { variantes, renderizar } = z
      .object({
        variantes: z
          .array(
            z.object({
              nombre: z.string().min(1).max(80),
              formato: z.string().refine((v) => PRESETS.some((p) => p.id === v), "Formato desconocido"),
              inicio: z.number().min(0).max(MAX_DURACION_SEG).default(0),
              /** Vacio = hasta el final del montaje. */
              duracion: z.number().min(1).max(MAX_DURACION_SEG).nullable().default(null),
            }),
          )
          .min(1)
          .max(8),
        renderizar: z.boolean().default(true),
      })
      .parse(req.body);
    await db.proyecto.findUniqueOrThrow({ where: { id } });

    const creadas = [];
    for (const v of variantes) {
      const fila = await db.variante.create({ data: { ...v, proyectoId: id } });
      if (renderizar) await encolarVariante(fila.id);
      creadas.push(fila);
    }
    return reply.code(201).send(creadas);
  });

  app.post("/api/proyectos/:id/variantes/:varianteId/render", async (req, reply) => {
    const { varianteId } = z.object({ varianteId: z.string().uuid() }).parse(req.params);
    await db.variante.findUniqueOrThrow({ where: { id: varianteId } });
    const job = await encolarVariante(varianteId);
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });

  app.delete("/api/proyectos/:id/variantes/:varianteId", async (req) => {
    const { varianteId } = z.object({ varianteId: z.string().uuid() }).parse(req.params);
    await db.variante.delete({ where: { id: varianteId } });
    return { ok: true };
  });

  app.get("/api/proyectos/:id/variantes/:varianteId/ver", async (req, reply) => {
    const { varianteId } = z.object({ varianteId: z.string().uuid() }).parse(req.params);
    const v = await db.variante.findUnique({ where: { id: varianteId } });
    if (!v?.archivo) return reply.code(404).send({ error: "El corte todavia no esta listo" });
    return servir(req, reply, rutaVideo(v.id), "video/mp4");
  });

  app.get("/api/proyectos/:id/variantes/:varianteId/descargar", async (req, reply) => {
    const { varianteId } = z.object({ varianteId: z.string().uuid() }).parse(req.params);
    const v = await db.variante.findUnique({ where: { id: varianteId } });
    if (!v?.archivo) return reply.code(404).send({ error: "El corte todavia no esta listo" });
    const limpio = v.nombre.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "corte";
    return servir(req, reply, rutaVideo(v.id), "video/mp4", `${limpio}-${v.formato}-${v.id.slice(0, 8)}.mp4`);
  });

  app.post("/api/proyectos/:id/render", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUniqueOrThrow({ where: { id } });
    if (!pistasDe(p).video.length) return reply.code(409).send({ error: "El proyecto no tiene clips" });
    const job = await encolarProyecto(id);
    return reply.code(202).send({ encolada: true, jobId: job.id });
  });

  /**
   * Créditos y descripción del proyecto. Si aún no se renderizó, se calculan
   * de los clips actuales; el .txt se descarga con el mismo nombre que el MP4.
   */
  app.get("/api/proyectos/:id/creditos", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id }, include: { historia: true } });
    if (!p) return reply.code(404).send({ error: "No encontrado" });
    const { video } = pistasDe(p);
    const guion = p.historia ? GuionSchema.safeParse(p.historia.guion) : null;
    const musica = creditosMusica(p.musica);
    const descripcion =
      p.descripcion ??
      descripcionDeProyecto(p.nombre, video, guion?.success ? guion.data.hashtags : [], guion?.success ? guion.data.gancho : null, musica);
    return { descripcion, creditos: creditosDeProyecto(video, musica) };
  });

  app.get("/api/proyectos/:id/creditos.txt", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id }, include: { historia: true } });
    if (!p) return reply.code(404).send({ error: "No encontrado" });
    const { video } = pistasDe(p);
    const guion = p.historia ? GuionSchema.safeParse(p.historia.guion) : null;
    const musica = creditosMusica(p.musica);
    const descripcion =
      p.descripcion ??
      descripcionDeProyecto(p.nombre, video, guion?.success ? guion.data.hashtags : [], guion?.success ? guion.data.gancho : null, musica);
    // El .txt lleva la descripción corta para pegar y, debajo, la lista completa con enlaces.
    const texto = [descripcion, "", "Créditos completos:", creditosDeProyecto(video, musica)].join("\n");
    reply
      .header("Content-Type", "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="proyecto-${p.id.slice(0, 8)}-creditos.txt"`);
    return reply.send(texto + "\n");
  });

  app.get("/api/proyectos/:id/ver", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    if (!p?.archivo) return reply.code(404).send({ error: "El video todavia no esta listo" });
    return servir(req, reply, rutaVideo(p.id), "video/mp4");
  });

  app.get("/api/proyectos/:id/descargar", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const p = await db.proyecto.findUnique({ where: { id } });
    if (!p?.archivo) return reply.code(404).send({ error: "El video todavia no esta listo" });
    return servir(req, reply, rutaVideo(p.id), "video/mp4", `proyecto-${p.id.slice(0, 8)}.mp4`);
  });

  /** Duracion total con las tres pistas, para avisar si se pasa del preset. */
  app.post("/api/proyectos/:id/duracion", async (req) => {
    const d = ProyectoSchema.pick({ video: true, textos: true, voz: true }).parse(req.body);
    return { segundos: duracionProyecto(d) };
  });
}
