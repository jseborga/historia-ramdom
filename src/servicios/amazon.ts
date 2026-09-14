import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { env } from "../env.js";
import type { ClipInfo } from "./clips.js";

/**
 * Productos de Amazon como gancho de un vídeo corto.
 *
 * Reglas de la casa, que son las de Amazon y no se negocian:
 *
 *  - Las fotos y los datos del producto SOLO pueden salir de la API oficial
 *    (Product Advertising API v5) y solo si hay cuenta de Afiliados. Bajarse
 *    la foto de la ficha pública está prohibido, así que aquí no se hace: sin
 *    credenciales no hay imágenes, y punto.
 *  - Todo enlace lleva la etiqueta de afiliado, y todo vídeo que lo use lleva
 *    la divulgación visible. Va en la descripción siempre, no como opción.
 *  - Los precios cambian cada hora: se enseñan como referencia del día y
 *    nunca se narran en el guion.
 *
 * Sin credenciales la sección sigue sirviendo: se pega el enlace del producto,
 * se saca el ASIN, se construye el enlace de afiliado y el vídeo se monta con
 * material propio o de los bancos abiertos.
 */

/** Tiendas donde se puede buscar, con su host de API y su región de firma. */
const MERCADOS = {
  "com": { dominio: "www.amazon.com", host: "webservices.amazon.com", region: "us-east-1", nombre: "Estados Unidos" },
  "es": { dominio: "www.amazon.es", host: "webservices.amazon.es", region: "eu-west-1", nombre: "España" },
  "com.mx": { dominio: "www.amazon.com.mx", host: "webservices.amazon.com.mx", region: "us-east-1", nombre: "México" },
  "com.br": { dominio: "www.amazon.com.br", host: "webservices.amazon.com.br", region: "us-east-1", nombre: "Brasil" },
  "co.uk": { dominio: "www.amazon.co.uk", host: "webservices.amazon.co.uk", region: "eu-west-1", nombre: "Reino Unido" },
  "de": { dominio: "www.amazon.de", host: "webservices.amazon.de", region: "eu-west-1", nombre: "Alemania" },
  "fr": { dominio: "www.amazon.fr", host: "webservices.amazon.fr", region: "eu-west-1", nombre: "Francia" },
  "it": { dominio: "www.amazon.it", host: "webservices.amazon.it", region: "eu-west-1", nombre: "Italia" },
  "ca": { dominio: "www.amazon.ca", host: "webservices.amazon.ca", region: "us-east-1", nombre: "Canadá" },
} as const;

export type Mercado = keyof typeof MERCADOS;
export const MERCADOS_ID = Object.keys(MERCADOS) as [Mercado, ...Mercado[]];
export const esMercado = (v: string): v is Mercado => v in MERCADOS;
export const catalogoMercados = () =>
  MERCADOS_ID.map((id) => ({ id, nombre: MERCADOS[id].nombre, dominio: MERCADOS[id].dominio }));

/** La tienda por defecto, la del entorno. */
export const mercadoPorDefecto = (): Mercado => (esMercado(env.AMAZON_MERCADO) ? env.AMAZON_MERCADO : "com");

/**
 * La frase que exige el programa de Afiliados. Va tal cual en la descripción
 * de cualquier vídeo con enlace, sin acortar ni disimular.
 */
export const DIVULGACION = "Como Afiliado de Amazon, gano por las compras adscritas.";

/** Hay etiqueta de afiliado: se pueden construir enlaces aunque no haya API. */
export const hayEtiqueta = () => Boolean(env.AMAZON_PARTNER_TAG);

/** Hay API: se pueden buscar productos y usar sus fotos. */
export const amazonConfigurado = () =>
  Boolean(env.AMAZON_ACCESS_KEY && env.AMAZON_SECRET_KEY && env.AMAZON_PARTNER_TAG);

/**
 * El ASIN de un producto a partir de lo que se pegue: la URL larga de la
 * ficha, la corta de amzn.to no (esa hay que abrirla), o el código suelto.
 */
export function asinDe(texto: string): string | null {
  const limpio = texto.trim();
  const enRuta = /\/(?:dp|gp\/product|gp\/aw\/d|product|ASIN)\/([A-Z0-9]{10})(?:[/?]|$)/i.exec(limpio);
  if (enRuta) return enRuta[1].toUpperCase();
  const enParametro = /[?&]asin=([A-Z0-9]{10})\b/i.exec(limpio);
  if (enParametro) return enParametro[1].toUpperCase();
  // Un ASIN suelto: diez caracteres, y los de Amazon empiezan por B casi
  // siempre (los libros son el ISBN de diez dígitos).
  if (/^(B[0-9A-Z]{9}|[0-9]{9}[0-9X])$/i.test(limpio)) return limpio.toUpperCase();
  return null;
}

/** El mercado que sugiere una URL pegada (amazon.com.mx → com.mx). */
export function mercadoDeEnlace(texto: string): Mercado | null {
  const host = /https?:\/\/(?:www\.)?amazon\.([a-z.]+)\b/i.exec(texto.trim());
  if (!host) return null;
  const sufijo = host[1].toLowerCase().replace(/\.$/, "");
  return esMercado(sufijo) ? sufijo : null;
}

/**
 * Enlace de afiliado de un producto. Sin etiqueta configurada devuelve el
 * enlace limpio: sirve para verlo, pero no genera comisión (y hay que decirlo
 * arriba, no esconderlo).
 */
export function enlaceAfiliado(asin: string, mercado: Mercado = mercadoPorDefecto()): string {
  const url = new URL(`https://${MERCADOS[mercado].dominio}/dp/${asin}`);
  if (env.AMAZON_PARTNER_TAG) {
    url.searchParams.set("tag", env.AMAZON_PARTNER_TAG);
    // linkCode identifica el tipo de enlace en los informes de Afiliados.
    url.searchParams.set("linkCode", "ll1");
  }
  return url.toString();
}

export const ProductoSchema = z.object({
  asin: z.string().regex(/^[A-Z0-9]{10}$/),
  mercado: z.enum(MERCADOS_ID),
  titulo: z.string().min(1).max(300),
  marca: z.string().max(120).default(""),
  /** Precio del día, como texto ya formateado por Amazon. Nunca se narra. */
  precio: z.string().max(40).default(""),
  /** Foto principal, siempre de la API; vacío si no hay credenciales. */
  imagen: z.string().max(700).default(""),
  imagenes: z.array(z.string().max(700)).max(8).default([]),
  caracteristicas: z.array(z.string().max(300)).max(8).default([]),
  /** Enlace de afiliado ya montado. */
  enlace: z.string().max(700),
});

export type Producto = z.infer<typeof ProductoSchema>;

/** Ficha mínima de un producto pegado a mano, sin API: enlace y poco más. */
export function productoManual(o: { asin: string; mercado: Mercado; titulo?: string }): Producto {
  return ProductoSchema.parse({
    asin: o.asin,
    mercado: o.mercado,
    titulo: (o.titulo ?? "").trim() || `Producto ${o.asin}`,
    enlace: enlaceAfiliado(o.asin, o.mercado),
  });
}

// ---------------------------------------------------------- API oficial (v5)

/** Lo que se pide de cada producto. Nada de reseñas: no están abiertas a todos. */
const RECURSOS = [
  "Images.Primary.Large",
  "Images.Variants.Large",
  "ItemInfo.Title",
  "ItemInfo.Features",
  "ItemInfo.ByLineInfo",
  "Offers.Listings.Price",
];

const SERVICIO = "ProductAdvertisingAPI";

const sha256 = (dato: string) => createHash("sha256").update(dato, "utf8").digest("hex");
const hmac = (clave: Buffer | string, dato: string) => createHmac("sha256", clave).update(dato, "utf8").digest();

/**
 * La clave de firma de SigV4: cuatro HMAC encadenados desde la clave secreta.
 * Sale aparte para poder comprobarla contra el vector de ejemplo de AWS, que
 * es lo único verificable sin una cuenta de Afiliados aprobada.
 */
export function claveDeFirma(secreta: string, fecha: string, region: string, servicio: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secreta}`, fecha), region), servicio), "aws4_request");
}

/**
 * Firma SigV4 de una petición a la PA-API. Se firman exactamente las
 * cabeceras que se envían; si alguna se queda fuera, Amazon contesta con un
 * error de firma que no dice cuál falta.
 */
function cabecerasFirmadas(mercado: Mercado, objetivo: string, cuerpo: string) {
  const { host, region } = MERCADOS[mercado];
  const ruta = `/paapi5/${objetivo.toLowerCase()}`;
  const ahora = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const fecha = ahora.slice(0, 8);

  const cabeceras: Record<string, string> = {
    "content-encoding": "amz-1.0",
    "content-type": "application/json; charset=utf-8",
    host,
    "x-amz-date": ahora,
    "x-amz-target": `com.amazon.paapi5.v1.ProductAdvertisingAPIv1.${objetivo}`,
  };
  const nombres = Object.keys(cabeceras).sort();
  const firmadas = nombres.join(";");
  const canonica = [
    "POST",
    ruta,
    "",
    nombres.map((n) => `${n}:${cabeceras[n].trim()}\n`).join(""),
    firmadas,
    sha256(cuerpo),
  ].join("\n");

  const alcance = `${fecha}/${region}/${SERVICIO}/aws4_request`;
  const porFirmar = ["AWS4-HMAC-SHA256", ahora, alcance, sha256(canonica)].join("\n");
  const clave = claveDeFirma(env.AMAZON_SECRET_KEY!, fecha, region, SERVICIO);
  const firma = createHmac("sha256", clave).update(porFirmar, "utf8").digest("hex");

  return {
    url: `https://${host}${ruta}`,
    cabeceras: {
      ...cabeceras,
      Authorization: `AWS4-HMAC-SHA256 Credential=${env.AMAZON_ACCESS_KEY}/${alcance}, SignedHeaders=${firmadas}, Signature=${firma}`,
    },
  };
}

type RespuestaAmazon = {
  SearchResult?: { Items?: unknown[] };
  ItemsResult?: { Items?: unknown[] };
  Errors?: { Code?: string; Message?: string }[];
};

async function llamar(mercado: Mercado, objetivo: "SearchItems" | "GetItems", cuerpo: Record<string, unknown>) {
  if (!amazonConfigurado()) {
    throw new Error(
      "Amazon no está configurado: hacen falta AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY y AMAZON_PARTNER_TAG " +
        "de una cuenta de Afiliados aprobada.",
    );
  }
  const json = JSON.stringify({
    ...cuerpo,
    PartnerTag: env.AMAZON_PARTNER_TAG,
    PartnerType: "Associates",
    Marketplace: MERCADOS[mercado].dominio,
    Resources: RECURSOS,
  });
  const { url, cabeceras } = cabecerasFirmadas(mercado, objetivo, json);

  const res = await fetch(url, {
    method: "POST",
    headers: cabeceras,
    body: json,
    signal: AbortSignal.timeout(20_000),
  });
  const texto = await res.text();
  let datos: RespuestaAmazon = {};
  try {
    datos = JSON.parse(texto) as RespuestaAmazon;
  } catch {
    /* Amazon contesta HTML cuando la cuenta no está aprobada. */
  }
  // El primer error de Amazon explica el motivo real (cuenta sin ventas,
  // etiqueta que no es de este mercado, clave revocada); el código HTTP no.
  const fallo = datos.Errors?.[0];
  if (fallo) throw new Error(`Amazon: ${fallo.Message ?? fallo.Code ?? "petición rechazada"}`.slice(0, 300));
  if (!res.ok) throw new Error(`Amazon respondió ${res.status}: ${texto.replace(/\s+/g, " ").slice(0, 160)}`);
  return datos;
}

type ItemAmazon = {
  ASIN?: string;
  DetailPageURL?: string;
  Images?: { Primary?: { Large?: { URL?: string } }; Variants?: { Large?: { URL?: string } }[] };
  ItemInfo?: {
    Title?: { DisplayValue?: string };
    Features?: { DisplayValues?: string[] };
    ByLineInfo?: { Brand?: { DisplayValue?: string }; Manufacturer?: { DisplayValue?: string } };
  };
  Offers?: { Listings?: { Price?: { DisplayAmount?: string } }[] };
};

/**
 * Ficha normalizada. El enlace se reconstruye aquí en vez de usar el
 * `DetailPageURL` de Amazon, para que siempre lleve la etiqueta aunque la
 * respuesta venga de una caché vieja.
 */
function aProducto(item: ItemAmazon, mercado: Mercado): Producto | null {
  const asin = item.ASIN;
  const titulo = item.ItemInfo?.Title?.DisplayValue;
  if (!asin || !titulo) return null;
  const principal = item.Images?.Primary?.Large?.URL ?? "";
  const variantes = (item.Images?.Variants ?? []).map((v) => v.Large?.URL).filter((u): u is string => Boolean(u));
  return ProductoSchema.parse({
    asin,
    mercado,
    titulo: titulo.slice(0, 300),
    marca: (item.ItemInfo?.ByLineInfo?.Brand?.DisplayValue ?? item.ItemInfo?.ByLineInfo?.Manufacturer?.DisplayValue ?? "").slice(0, 120),
    precio: (item.Offers?.Listings?.[0]?.Price?.DisplayAmount ?? "").slice(0, 40),
    imagen: principal,
    imagenes: [principal, ...variantes].filter(Boolean).slice(0, 8),
    caracteristicas: (item.ItemInfo?.Features?.DisplayValues ?? []).slice(0, 8).map((f) => f.slice(0, 300)),
    enlace: enlaceAfiliado(asin, mercado),
  });
}

/** Cómo ordenar la búsqueda; "lo viral" es lo más vendido y lo mejor valorado. */
export const ORDENES = ["Relevance", "Featured", "AvgCustomerReviews", "NewestArrivals"] as const;
export type Orden = (typeof ORDENES)[number];

export async function buscarProductos(
  consulta: string,
  o: { mercado?: Mercado; orden?: Orden; cuantos?: number } = {},
): Promise<Producto[]> {
  const mercado = o.mercado ?? mercadoPorDefecto();
  const datos = await llamar(mercado, "SearchItems", {
    Keywords: consulta.slice(0, 200),
    SearchIndex: "All",
    ItemCount: Math.min(10, Math.max(1, o.cuantos ?? 8)),
    SortBy: o.orden ?? "Featured",
  });
  return ((datos.SearchResult?.Items ?? []) as ItemAmazon[])
    .map((i) => aProducto(i, mercado))
    .filter((p): p is Producto => p !== null);
}

export async function productoPorAsin(asin: string, mercado: Mercado = mercadoPorDefecto()): Promise<Producto | null> {
  const datos = await llamar(mercado, "GetItems", { ItemIds: [asin] });
  const items = (datos.ItemsResult?.Items ?? []) as ItemAmazon[];
  return items.length ? aProducto(items[0], mercado) : null;
}

/**
 * Una foto del producto convertida en clip. Solo se usa con fotos que vienen
 * de la API: `pagina` es el enlace de afiliado, que es la condición con la
 * que Amazon deja enseñarlas.
 */
export function clipDeProducto(p: Producto, indice = 0): ClipInfo {
  const url = p.imagenes[indice] ?? p.imagen;
  if (!url) throw new Error("Ese producto no trae foto de la API de Amazon");
  return {
    id: `amazon-${p.asin}-${indice}`,
    fuente: "amazon",
    tipo: "imagen",
    autor: p.marca || p.titulo.slice(0, 60),
    pagina: p.enlace,
    licencia: "Imagen de producto de Amazon (uso con enlace de afiliado)",
    url,
    imagen: url,
  };
}
