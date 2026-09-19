import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { env, MAX_CLIP_BYTES } from "../env.js";
import { rutaMedioSeguro, crearCarpetaProyecto } from "../almacen.js";
import {
  borrarMedio,
  clipDeMedio,
  guardarDeBanco,
  guardarSubida,
  miniaturaDe,
  EXT_IMAGEN,
  EXT_VIDEO,
} from "../servicios/medios.js";
import {
  buscarClips,
  destinoAdmitido,
  esBancoElegible,
  esMedio,
  hostPermitido,
  type TipoMedio,
} from "../servicios/clips.js";
import { ClipPistaSchema, ProyectoSchema, efectoDeClip, type ClipPista } from "../servicios/proyecto.js";
import { buscarPreset } from "../render/presets.js";

/**
 * La biblioteca de vídeo y foto: subir, guardar lo que se encuentra en los
 * bancos, verlo y componer un montaje con lo elegido.
 *
 * Componer no renderiza nada: deja un proyecto en el editor de montaje, que es
 * donde se ajusta la duración de cada plano, el texto y la música.
 */

const idParam = z.object({ id: z.string().uuid() });

/** Segundos que dura una foto en la línea de tiempo si no se dice otra cosa. */
const SEGUNDOS_FOTO = 3.5;
/** Tope de un plano de vídeo al componer; el editor lo estira si hace falta. */
const MAX_PLANO = 12;

const TIPOS: Record<string, string> = {
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const tipoDe = (archivo: string) => TIPOS[(/\.([a-z0-9]+)$/i.exec(archivo)?.[1] ?? "").toLowerCase()] ?? "application/octet-stream";

/** Sirve un archivo con Range, para que el reproductor pueda saltar. */
async function servir(req: FastifyRequest, reply: FastifyReply, ruta: string, tipo: string) {
  const info = await stat(ruta).catch(() => null);
  if (!info) return reply.code(404).send({ error: "El archivo ya no esta en el servidor" });

  reply.header("Content-Type", tipo).header("Accept-Ranges", "bytes");
  const rango = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (!rango) {
    reply.header("Content-Length", info.size);
    return reply.send(createReadStream(ruta));
  }
  const desde = rango[1] ? Number(rango[1]) : 0;
  const hasta = rango[2] ? Math.min(Number(rango[2]), info.size - 1) : info.size - 1;
  if (desde >= info.size || hasta < desde) {
    return reply.code(416).header("Content-Range", `bytes */${info.size}`).send();
  }
  return reply
    .code(206)
    .header("Content-Range", `bytes ${desde}-${hasta}/${info.size}`)
    .header("Content-Length", hasta - desde + 1)
    .send(createReadStream(ruta, { start: desde, end: hasta }));
}

/**
 * Las muestras no son peticiones "de usuario": una rejilla de resultados pide
 * veinte de golpe, y la galeria otras tantas. Con el limite general de la app
 * (120 por minuto) se agotaban solas y las imagenes dejaban de cargar sin
 * decir nada. Son GET baratos y con sesion, asi que llevan su propio limite.
 */
const LIMITE_MUESTRAS = { max: 1200, timeWindow: "1 minute" };

/** Tipos de imagen que se aceptan como muestra; nada de HTML ni SVG. */
const IMAGENES_OK = /^image\/(jpeg|png|webp|gif)$/;
/** Una miniatura no pesa megas; si pesa, algo raro pasa. */
const MAX_MUESTRA = 12 * 1024 * 1024;
/** Wikimedia y Archive contestan 400 a quien no se identifica. */
const AGENTE_MUESTRAS = "estudio-voz-en-off/1.0 (https://github.com/jseborga/historia-ramdom)";

export async function rutasMedios(app: FastifyInstance) {
  /**
   * Muestra de un banco servida por la app.
   *
   * Las miniaturas se enlazaban directamente al CDN, y eso se cae por muchos
   * sitios: politicas de contenido del navegador, redes que bloquean terceros,
   * CDN que no admiten enlazado externo. Aqui se traen por el servidor, que ya
   * tiene la lista de dominios permitidos, y salen como imagenes propias.
   *
   * Solo GET, solo https, solo los dominios de los bancos y solo imagenes: una
   * direccion manipulada no puede llegar a la red interna.
   */
  app.get("/api/muestra", { config: { rateLimit: LIMITE_MUESTRAS } }, async (req, reply) => {
    const { url } = z.object({ url: z.string().min(10).max(700) }).parse(req.query);
    let destino: URL;
    try {
      destino = new URL(url);
    } catch {
      return reply.code(400).send({ error: "Direccion invalida" });
    }

    // Openverse indexa imagenes de medio Internet y Archive redirige a un
    // servidor distinto en cada peticion: no hay lista de dominios que valga.
    // Se aplica la misma regla que al descargar —https, nada que apunte a la
    // red interna y solo imagenes— y se siguen las redirecciones revisando
    // cada salto.
    let actual = destino;
    for (let saltos = 0; saltos < 3; saltos++) {
      try {
        await destinoAdmitido(actual, !hostPermitido(actual));
      } catch (err) {
        return reply.code(403).send({ error: err instanceof Error ? err.message : "Dominio no permitido" });
      }
      const res = await fetch(actual, {
        redirect: "manual",
        headers: { "User-Agent": AGENTE_MUESTRAS },
        signal: AbortSignal.timeout(20_000),
      }).catch(() => null);
      if (!res) return reply.code(502).send({ error: "No se pudo pedir la imagen a la fuente" });

      const siguiente = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && siguiente) {
        actual = new URL(siguiente, actual);
        continue;
      }
      if (!res.ok) return reply.code(502).send({ error: `La fuente devolvio ${res.status}` });

      // El tipo llega con parametros ("image/jpeg; charset=UTF-8"): se compara
      // solo el tipo, que es lo que importa.
      const tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!IMAGENES_OK.test(tipo)) return reply.code(415).send({ error: `Eso no es una imagen (${tipo})` });
      const datos = Buffer.from(await res.arrayBuffer());
      if (datos.length > MAX_MUESTRA) return reply.code(413).send({ error: "Imagen demasiado grande" });

      return reply
        .header("Content-Type", tipo)
        .header("Cache-Control", "public, max-age=86400")
        .send(datos);
    }
    return reply.code(502).send({ error: "Demasiadas redirecciones" });
  });

  /** La biblioteca, con filtro por clase y por texto. */
  app.get("/api/medios", async (req) => {
    const { clase, q, limite } = z
      .object({
        clase: z.enum(["VIDEO", "IMAGEN"]).optional(),
        q: z.string().max(80).optional(),
        limite: z.coerce.number().int().min(1).max(200).default(120),
      })
      .parse(req.query);

    const medios = await db.medio.findMany({
      where: {
        ...(clase ? { clase } : {}),
        ...(q?.trim()
          ? {
              OR: [
                { nombre: { contains: q.trim(), mode: "insensitive" as const } },
                { etiquetas: { has: q.trim().toLowerCase() } },
              ],
            }
          : {}),
      },
      orderBy: { creadoEn: "desc" },
      take: limite,
    });
    return medios.map((m) => ({ ...m, clip: clipDeMedio(m) }));
  });

  /**
   * Sube un vídeo o una foto. El nombre del archivo lo pone el servidor y el
   * contenido se comprueba con ffprobe: la extensión sola no prueba nada.
   */
  app.post("/api/medios/subir", async (req, reply) => {
    const subido = await req.file({ limits: { fileSize: MAX_CLIP_BYTES } });
    if (!subido) return reply.code(400).send({ error: "No llego ningun archivo" });
    const nombre = subido.filename ?? "";
    if (!EXT_VIDEO.test(nombre) && !EXT_IMAGEN.test(nombre)) {
      return reply.code(415).send({ error: "Formato no admitido: usa mp4, mov, m4v, webm, jpg, png o webp" });
    }
    const datos = await subido.toBuffer().catch(() => null);
    if (!datos) return reply.code(413).send({ error: `El archivo supera los ${env.MAX_CLIP_MB} MB` });

    const r = await guardarSubida(datos, nombre);
    if (!r.ok) return reply.code(415).send({ error: r.mensaje });
    return reply.code(201).send({ ...r.medio, clip: clipDeMedio(r.medio) });
  });

  /**
   * Guarda en la biblioteca algo de un banco. Del navegador solo llega el id y
   * las palabras con las que se encontró: el enlace se resuelve aquí, contra la
   * misma búsqueda, para que nadie pueda colar una dirección.
   */
  app.post("/api/medios/guardar", async (req, reply) => {
    const { id, keywords, bancos, medios } = z
      .object({
        id: z.string().min(3).max(200),
        keywords: z.string().min(1).max(200),
        bancos: z.array(z.string().max(20)).max(3).default([]),
        medios: z.array(z.string().max(20)).max(2).default([]),
      })
      .parse(req.body);

    const opciones = {
      bancos: bancos.filter(esBancoElegible),
      medios: (medios.filter(esMedio) as TipoMedio[]).length
        ? (medios.filter(esMedio) as TipoMedio[])
        : (["video", "imagen"] as TipoMedio[]),
    };
    const listas = await Promise.all(
      keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((k) => buscarClips(k, opciones)),
    );
    const clip = listas.flat().find((c) => c.id === id);
    if (!clip) return reply.code(404).send({ error: "Ese material ya no aparece en la busqueda" });

    const r = await guardarDeBanco(clip, keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean));
    if (!r.ok) return reply.code(422).send({ error: r.mensaje });
    return reply.code(201).send({ ...r.medio, clip: clipDeMedio(r.medio) });
  });

  app.get("/api/medios/:id/ver", { config: { rateLimit: LIMITE_MUESTRAS } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const m = await db.medio.findUnique({ where: { id } });
    if (!m) return reply.code(404).send({ error: "No encontrado" });
    return servir(req, reply, rutaMedioSeguro(m.archivo), tipoDe(m.archivo));
  });

  app.get("/api/medios/:id/miniatura", { config: { rateLimit: LIMITE_MUESTRAS } }, async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const m = await db.medio.findUnique({ where: { id } });
    if (!m) return reply.code(404).send({ error: "No encontrado" });
    try {
      reply.header("Cache-Control", "public, max-age=86400");
      return servir(req, reply, await miniaturaDe(m), "image/jpeg");
    } catch {
      return reply.code(422).send({ error: "No se pudo sacar la miniatura" });
    }
  });

  app.delete("/api/medios/:id", async (req, reply) => {
    const { id } = idParam.parse(req.params);
    return (await borrarMedio(id)) ? { borrado: true } : reply.code(404).send({ error: "No encontrado" });
  });

  /**
   * Compone un montaje con lo elegido, en ese orden: cada foto dura lo que se
   * diga y se anima sola; cada vídeo entra con su duración real (acotada), y
   * el proyecto se abre en el editor para ajustar el resto.
   */
  app.post("/api/medios/componer", async (req, reply) => {
    const { medios, nombre, formato, segundosFoto, maxPlano } = z
      .object({
        medios: z.array(z.string().uuid()).min(1).max(60),
        nombre: z.string().min(1).max(120).default("Composicion"),
        formato: z.string().max(40).default("tiktok"),
        segundosFoto: z.number().min(0.5).max(30).default(SEGUNDOS_FOTO),
        maxPlano: z.number().min(1).max(60).default(MAX_PLANO),
      })
      .parse(req.body);

    const filas = await db.medio.findMany({ where: { id: { in: medios } } });
    if (!filas.length) return reply.code(404).send({ error: "Ninguno de esos medios existe" });
    // El orden lo decide quien compone, no la base de datos.
    const porId = new Map(filas.map((m) => [m.id, m]));
    const elegidos = medios.map((id) => porId.get(id)).filter((m): m is (typeof filas)[number] => Boolean(m));

    const video: ClipPista[] = elegidos.map((m, i) => {
      const clip = clipDeMedio(m);
      const duracion =
        clip.tipo === "imagen" ? segundosFoto : Math.min(Math.max(clip.duracion ?? maxPlano, 1), maxPlano);
      return ClipPistaSchema.parse({
        id: randomUUID(),
        clip,
        duracion,
        efecto: efectoDeClip(clip, i),
      });
    });

    const datos = ProyectoSchema.parse({
      nombre,
      formato: buscarPreset(formato).id,
      video,
      textos: [],
      // Sin narración: una composición se hace mirándola, y si luego hace falta
      // voz se añade en el editor.
      voz: { modo: "ninguna", texto: "" },
      musica: {},
    });
    const proyecto = await db.proyecto.create({
      data: {
        nombre: datos.nombre,
        formato: datos.formato,
        escenas: datos.video,
        textos: datos.textos,
        voz: datos.voz,
        musica: datos.musica,
      },
    });
    await crearCarpetaProyecto(proyecto.id);
    return reply.code(201).send(proyecto);
  });
}
