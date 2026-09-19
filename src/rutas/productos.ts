import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { crearCarpetaProyecto } from "../almacen.js";
import { buscarPreset } from "../render/presets.js";
import { env } from "../env.js";
import {
  DIVULGACION,
  MERCADOS_ID,
  ORDENES,
  ProductoSchema,
  amazonConfigurado,
  asinDe,
  buscarProductos,
  catalogoMercados,
  clipDeProducto,
  enlaceAfiliado,
  hayEtiqueta,
  mercadoDeEnlace,
  mercadoPorDefecto,
  productoManual,
  productoPorAsin,
  type Producto,
} from "../servicios/amazon.js";
import {
  GuionProductoSchema,
  IdiomaCampo,
  MOTORES,
  generarGuionProducto,
  narracionDeProducto,
} from "../servicios/guion.js";
import { VozSchema } from "../servicios/voz.js";
import { ensamblarProyecto } from "../servicios/ensamblar.js";
import {
  ClipPistaSchema,
  ProyectoSchema,
  PublicacionSchema,
  bloqueProducto,
  clipVacio,
  efectoDeClip,
  publicacionDeProyecto,
  type ClipPista,
} from "../servicios/proyecto.js";
import { clipDeMedio, guardarDeBanco } from "../servicios/medios.js";
import { esBanco, esMedio, type Banco, type TipoMedio } from "../servicios/clips.js";
import { CategoriaCampo, SubcategoriaCampo, BancosCampo, MediosCampo } from "./historias.js";
import { conMotivo } from "./errores.js";

/**
 * Productos de Amazon como gancho, con reflexión detrás.
 *
 * El vídeo no es un anuncio: el objeto entra como excusa y lo que se recuerda
 * es el giro final. Por eso el guion se escribe aparte y se puede corregir
 * antes de montar nada.
 *
 * Lo que Amazon permite mandan aquí: las fotos y los datos solo salen de la
 * API de Afiliados (si hay credenciales), el enlace lleva siempre la etiqueta
 * y la divulgación va en la descripción del proyecto, guardada con él para
 * que ningún render la borre.
 */

/** Segundos que dura en pantalla una foto del producto o de la galería. */
const SEGUNDOS_FOTO = 3.5;
const MAX_PLANO = 12;

const MercadoCampo = z.enum(MERCADOS_ID).optional();

/**
 * Lo que dice Amazon cuando rechaza una peticion es lo unico que sirve para
 * arreglarla ("la cuenta todavia no tiene ventas", "esa etiqueta no es de este
 * mercado"). El manejador general convierte cualquier 500 en "Error interno",
 * asi que aqui se contesta 502 con el motivo. Nunca lleva claves: es el texto
 * de Amazon y, como mucho, el codigo de respuesta.
 */
const fallaAmazon = (err: unknown) => ({
  error: (err instanceof Error ? err.message : "Amazon no respondio").slice(0, 300),
});

export async function rutasProductos(app: FastifyInstance) {
  /** Qué se puede hacer ahora mismo: buscar con la API, o solo pegar enlaces. */
  app.get("/api/amazon", async () => ({
    api: amazonConfigurado(),
    etiqueta: hayEtiqueta(),
    mercado: mercadoPorDefecto(),
    mercados: catalogoMercados(),
    divulgacion: DIVULGACION,
    ordenes: ORDENES,
    nota: amazonConfigurado()
      ? "Las fotos y los datos vienen de la API de Afiliados; el enlace lleva tu etiqueta."
      : hayEtiqueta()
        ? "Sin AMAZON_ACCESS_KEY y AMAZON_SECRET_KEY no hay fotos ni fichas: pega el enlace del producto y monta el video con material propio o de los bancos."
        : "Sin AMAZON_PARTNER_TAG los enlaces no generan comision. Ponla en Ajustes para que el video sirva de algo.",
  }));

  /** Busca productos en Amazon. Solo con la API oficial: no hay otra forma. */
  app.post("/api/amazon/buscar", async (req, reply) => {
    const { consulta, mercado, orden } = z
      .object({
        consulta: z.string().min(2).max(200),
        mercado: MercadoCampo,
        orden: z.enum(ORDENES).default("Featured"),
      })
      .parse(req.body);
    if (!amazonConfigurado()) {
      return reply.code(409).send({
        error:
          "Buscar productos necesita la API de Afiliados (AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY y " +
          "AMAZON_PARTNER_TAG). Mientras tanto, pega el enlace del producto.",
      });
    }
    try {
      return { productos: await buscarProductos(consulta, { mercado, orden }) };
    } catch (err) {
      return reply.code(502).send(fallaAmazon(err));
    }
  });

  /**
   * La ficha de un producto a partir de lo que se pegue. Con API se traen
   * fotos y características; sin ella se devuelve lo mínimo: ASIN, título
   * escrito a mano y el enlace de afiliado, que es lo que sí se puede hacer.
   */
  app.post("/api/amazon/producto", async (req, reply) => {
    const { enlace, titulo, mercado } = z
      .object({
        enlace: z.string().min(10).max(700),
        titulo: z.string().max(300).optional(),
        mercado: MercadoCampo,
      })
      .parse(req.body);

    const asin = asinDe(enlace);
    if (!asin) {
      return reply.code(400).send({
        error: "De ahi no sale ningun ASIN. Pega la direccion larga del producto (la que lleva /dp/) o el codigo de 10 caracteres.",
      });
    }
    const tienda = mercado ?? mercadoDeEnlace(enlace) ?? mercadoPorDefecto();

    // Si la API falla, no se bloquea el trabajo: se sigue con la ficha a mano
    // y se dice por qué no hubo fotos.
    let aviso = "";
    if (amazonConfigurado()) {
      try {
        const p = await productoPorAsin(asin, tienda);
        if (p) return { producto: p, api: true };
        aviso = "Amazon no devolvio ese producto en esta tienda; comprueba el mercado.";
      } catch (err) {
        aviso = fallaAmazon(err).error;
      }
    }
    return { producto: productoManual({ asin, mercado: tienda, titulo }), api: false, aviso: aviso || undefined };
  });

  /**
   * Guarda fotos del producto en la galería, para poder componerlas con
   * material propio. Solo fotos de la API: las de la ficha pública no se
   * pueden usar, así que aquí no hay forma de pedirlas.
   */
  app.post("/api/amazon/guardar", async (req, reply) => {
    const { producto, cuantas } = z
      .object({ producto: ProductoSchema, cuantas: z.number().int().min(1).max(5).default(1) })
      .parse(req.body);
    if (!producto.imagenes.length) {
      return reply.code(409).send({ error: "Ese producto no trae fotos de la API de Amazon" });
    }
    const guardados = [];
    const fallos: string[] = [];
    for (let i = 0; i < Math.min(cuantas, producto.imagenes.length); i++) {
      try {
        const r = await guardarDeBanco(clipDeProducto(producto, i), ["amazon", producto.asin]);
        if (r.ok) guardados.push(r.medio);
        else fallos.push(r.mensaje);
      } catch (err) {
        fallos.push(err instanceof Error ? err.message : "No se pudo descargar la foto");
      }
    }
    if (!guardados.length) return reply.code(502).send({ error: fallos[0] ?? "No se pudo guardar ninguna foto" });
    return { medios: guardados, aviso: fallos[0] };
  });

  /** Escribe el guion sin montar nada, para leerlo y corregirlo. */
  app.post("/api/producto", async (req, reply) => {
    const p = z
      .object({
        producto: z.object({
          titulo: z.string().min(1).max(300),
          marca: z.string().max(120).default(""),
          caracteristicas: z.array(z.string().max(300)).max(8).default([]),
        }),
        angulo: z.string().max(200).default(""),
        motor: z.enum(MOTORES).default("groq"),
        modelo: z.string().max(80).nullable().default(null),
        duracion: z.number().int().min(20).max(300).default(45),
        idioma: IdiomaCampo.default("es"),
        region: z.enum(["bolivia", "latam", "eeuu"]).default("bolivia"),
        modismos: z.boolean().default(true),
        categoria: CategoriaCampo,
        subcategoria: SubcategoriaCampo,
      })
      .parse(req.body);
    return conMotivo(reply, () => generarGuionProducto(p));
  });

  /**
   * Monta el vídeo: narración del guion, la foto del producto y lo que se
   * haya elegido de la galería delante, y el resto relleno con clips del
   * ambiente. La descripción se guarda ya con el enlace y la divulgación.
   */
  app.post("/api/productos", async (req, reply) => {
    const { guion, producto, medios, formato, nombre, voz, segundosFoto, bancos, tiposMedio, conFoto, idioma } = z
      .object({
        guion: GuionProductoSchema,
        producto: ProductoSchema,
        /** Ids de la galería que van delante, en este orden. */
        medios: z.array(z.string().uuid()).max(20).default([]),
        formato: z.string().max(40).default("tiktok"),
        nombre: z.string().min(1).max(120).optional(),
        voz: VozSchema.optional(),
        segundosFoto: z.number().min(0.5).max(30).default(SEGUNDOS_FOTO),
        bancos: BancosCampo,
        tiposMedio: MediosCampo,
        /** Abrir con la foto del producto (solo si vino de la API). */
        conFoto: z.boolean().default(true),
        /** El mismo con el que se escribió el guion: fija la voz y el tono. */
        idioma: IdiomaCampo.default("es"),
      })
      .parse(req.body);

    // El enlace se vuelve a montar aquí: el navegador no decide la etiqueta de
    // afiliado ni el mercado de un enlace que va a publicarse.
    const ficha: Producto = { ...producto, enlace: enlaceAfiliado(producto.asin, producto.mercado) };

    const fijos: ClipPista[] = [];
    if (conFoto && ficha.imagen) {
      const clip = clipDeProducto(ficha, 0);
      fijos.push(
        ClipPistaSchema.parse({ id: randomUUID(), clip, duracion: segundosFoto, efecto: efectoDeClip(clip, 0) }),
      );
    }
    if (medios.length) {
      const filas = await db.medio.findMany({ where: { id: { in: medios } } });
      const porId = new Map(filas.map((m) => [m.id, m]));
      for (const id of medios) {
        const m = porId.get(id);
        if (!m) continue;
        const clip = clipDeMedio(m);
        fijos.push(
          ClipPistaSchema.parse({
            id: randomUUID(),
            clip,
            duracion:
              clip.tipo === "imagen" ? segundosFoto : Math.min(Math.max(clip.duracion ?? MAX_PLANO, 1), MAX_PLANO),
            efecto: efectoDeClip(clip, fijos.length),
          }),
        );
      }
    }

    const datos = ProyectoSchema.parse({
      nombre: nombre ?? guion.titulo,
      formato: buscarPreset(formato).id,
      // El vídeo se rellena al ensamblar, cuando ya se sabe cuánto dura la voz.
      video: [clipVacio()],
      textos: [],
      voz: {
        modo: "servidor",
        texto: narracionDeProducto(guion),
        idioma,
        ...(voz ? { config: voz } : {}),
      },
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
        // Con qué se publica: el gancho viral del guion, sus etiquetas y el
        // producto con su enlace. El render rehace la descripción con esto.
        publicacion: PublicacionSchema.parse({
          producto: ficha,
          gancho: guion.gancho.slice(0, 200),
          ganchos: guion.ganchos,
          hashtags: guion.hashtags,
        }),
      },
    });
    await crearCarpetaProyecto(proyecto.id);

    try {
      await ensamblarProyecto(proyecto.id, {
        idioma,
        criterios: guion.keywords,
        fijos,
        medios: {
          bancos: bancos.filter(esBanco) as Banco[],
          medios: tiposMedio.filter(esMedio) as TipoMedio[],
        },
      });
    } catch (err) {
      // El guion y el producto se quedan guardados: se reintenta desde el
      // editor sin volver a escribir nada.
      return reply.code(207).send({
        ...proyecto,
        aviso: `El guion se guardo, pero el montaje fallo: ${err instanceof Error ? err.message : "error"}`,
      });
    }

    return reply.code(201).send(await db.proyecto.findUniqueOrThrow({ where: { id: proyecto.id } }));
  });

  /**
   * Cambia el producto de un proyecto ya creado (o lo quita). Sirve cuando el
   * enlace cambia de mercado o el vídeo deja de llevar producto: la
   * descripción se recalcula sola en el siguiente render.
   */
  app.post("/api/proyectos/:id/producto", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { producto } = z.object({ producto: ProductoSchema.nullable() }).parse(req.body);
    const ficha = producto ? { ...producto, enlace: enlaceAfiliado(producto.asin, producto.mercado) } : null;
    const p = await db.proyecto.findUniqueOrThrow({ where: { id }, select: { publicacion: true } });
    // Se cambia el producto sin tocar el gancho ni las etiquetas: quitarlo es
    // quitar su enlace de la descripción, no vaciar la publicación entera.
    const publicacion = PublicacionSchema.parse({
      ...(publicacionDeProyecto(p.publicacion) ?? {}),
      producto: ficha,
    });
    await db.proyecto.update({ where: { id }, data: { publicacion } });
    return { producto: ficha, descripcion: bloqueProducto(ficha) };
  });
}

/** Para los diagnósticos y el catálogo: si la API está lista, sin exponer claves. */
export const amazonListo = () => ({ api: amazonConfigurado(), etiqueta: Boolean(env.AMAZON_PARTNER_TAG) });
