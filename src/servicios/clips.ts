import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Redis } from "ioredis";
import { env, MAX_CLIP_BYTES } from "../env.js";
import { leerJSON } from "../util/http.js";
import { buscarArchive, buscarOpenverse, buscarWikimedia } from "./bancosLibres.js";

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

/**
 * Solo se descargan archivos de los CDN de Pexels, Pixabay y la NASA. Asi una
 * URL manipulada no puede hacer que el servidor acceda a direcciones internas
 * (SSRF).
 */
/**
 * Dominios con subdominios variables: Internet Archive sirve desde
 * `dn720003.ca.archive.org` y Wikimedia desde `upload.` o `thumb.`, asi que no
 * se pueden listar uno a uno.
 */
const SUFIJOS_PERMITIDOS = [".archive.org", ".wikimedia.org", ".openverse.org"];

export const hostPermitido = (u: URL) =>
  u.protocol === "https:" &&
  (HOSTS_PERMITIDOS.has(u.hostname) || SUFIJOS_PERMITIDOS.some((s) => u.hostname.endsWith(s)));

const HOSTS_PERMITIDOS = new Set([
  "videos.pexels.com",
  "images.pexels.com",
  "player.vimeo.com",
  "cdn.pixabay.com",
  "pixabay.com",
  // Pixabay sirve los videos y las miniaturas de sus entradas antiguas desde
  // estos dos; sin ellos, sus resultados salen sin muestra o no se descargan.
  "videos.pixabay.com",
  "i.vimeocdn.com",
  "images-assets.nasa.gov",
  "api.openverse.org",
  "archive.org",
  "commons.wikimedia.org",
  "upload.wikimedia.org",
  // Fotos de producto de Amazon: solo llegan aqui desde la API de Afiliados
  // (ver servicios/amazon.ts), nunca de una ficha publica.
  "m.media-amazon.com",
  "images-na.ssl-images-amazon.com",
]);

/** De dónde pueden salir las imágenes y los vídeos. */
export const BANCOS = ["pexels", "pixabay", "nasa", "openverse", "wikimedia", "archive"] as const;
export type Banco = (typeof BANCOS)[number];
export const esBanco = (v: string): v is Banco => (BANCOS as readonly string[]).includes(v);

/**
 * Vídeo o foto. Las fotos se animan en el render (Ken Burns): una imagen
 * quieta en un vertical parece un error, con movimiento parece animación.
 */
export const MEDIOS = ["video", "imagen"] as const;
export type TipoMedio = (typeof MEDIOS)[number];
export const esMedio = (v: string): v is TipoMedio => (MEDIOS as readonly string[]).includes(v);

/**
 * Origen de un clip: un banco, la biblioteca propia, o una foto de producto
 * de Amazon (que no es un banco: no se busca por keyword, viene de su API).
 */
export const FUENTES = [...BANCOS, "subido", "amazon"] as const;
export type Fuente = (typeof FUENTES)[number];

export type ClipInfo = {
  id: string;
  fuente: Fuente;
  /** "imagen" = foto; en la línea de tiempo se anima para que no quede quieta. */
  tipo: TipoMedio;
  autor: string;
  pagina: string;
  licencia: string;
  url: string;
  /** Fotograma de muestra, para elegir el clip sin descargarlo. */
  imagen?: string;
  /** Duracion real del archivo en origen, en segundos. */
  duracion?: number;
  /**
   * Nombre en la biblioteca de medios. Si está, el render lee el archivo del
   * disco en vez de descargar nada y `url` solo sirve para la vista previa.
   */
  archivo?: string;
};

/** Qué buscar y dónde. Vacío = lo de siempre: vídeo de Pexels y Pixabay. */
export type OpcionesMedios = {
  /** Bancos donde buscar; vacío = todos los que tengan clave. */
  bancos?: Banco[];
  /** Vídeo, foto o las dos cosas; vacío = solo vídeo. */
  medios?: TipoMedio[];
  /** Poner delante los clips de 30 s o más. */
  largos?: boolean;
};

/** A partir de aqui un clip cuenta como "largo". */
export const CLIP_LARGO = 30;

/** Pexels y Pixabay piden clave; los otros cuatro son abiertos. */
export const bancosDisponibles = (): Banco[] =>
  [
    env.PEXELS_API_KEY ? ("pexels" as const) : null,
    env.PIXABAY_API_KEY ? ("pixabay" as const) : null,
    "nasa" as const,
    "openverse" as const,
    "wikimedia" as const,
    "archive" as const,
  ].filter((b): b is Banco => b !== null);

/** Quien descarga: Wikimedia y Archive piden que la peticion se identifique. */
const AGENTE_DESCARGA = "estudio-voz-en-off/1.0 (https://github.com/jseborga/historia-ramdom)";

/** Extensión con la que se guarda: una foto con nombre `.mp4` confunde a ffmpeg. */
export function extensionMedio(clip: Pick<ClipInfo, "tipo" | "url" | "archivo">) {
  // Lo de la biblioteca ya tiene extension buena en el nombre del archivo.
  const nombre = clip.archivo ?? clip.url;
  const ext = /\.([a-z0-9]+)$/i.exec(clip.archivo ? nombre : new URL(nombre).pathname);
  if (clip.tipo === "imagen") return ext && /^(jpe?g|png|webp)$/i.test(ext[1]) ? `.${ext[1].toLowerCase()}` : ".jpg";
  return ext && /^(mp4|mov|m4v|webm)$/i.test(ext[1]) ? `.${ext[1].toLowerCase()}` : ".mp4";
}

export type EscenaPreparada = {
  texto: string;
  keywords: string[];
  clip: ClipInfo;
  /** Nombre del clip descargado; falta cuando solo se guardo el enlace. */
  archivo?: string;
  audio?: string;
};

/** Pixabay exige cachear sus resultados 24 h; lo aplicamos tambien a Pexels. */
const CACHE_SEG = 86_400;
/**
 * Cuando un banco ha fallado, lo que se guarda es una respuesta a medias: se
 * cachea unos minutos en vez de un día, para que un 429 pasajero no deje la
 * búsqueda vacía hasta mañana.
 */
const CACHE_FALLO_SEG = 300;

export async function buscarConCache<T>(
  clave: string,
  buscar: () => Promise<T>,
  segundos: number | ((r: T) => number) = CACHE_SEG,
): Promise<T> {
  const guardado = await redis.get(clave);
  if (guardado) return JSON.parse(guardado) as T;
  const resultado = await buscar();
  const ex = typeof segundos === "function" ? segundos(resultado) : segundos;
  await redis.set(clave, JSON.stringify(resultado), "EX", Math.max(30, ex));
  return resultado;
}

/**
 * Bancos cuyos archivos viven en servidores de terceros (Openverse indexa
 * Flickr, museos, archivos...): no hay lista de dominios que valga, así que se
 * comprueba a mano que el destino sea público y que lo que llega sea una
 * imagen.
 */
const ORIGEN_ABIERTO: Partial<Record<Fuente, boolean>> = { openverse: true };

export const esOrigenAbierto = (fuente: Fuente) => Boolean(ORIGEN_ABIERTO[fuente]);

/** Rangos que no salen a Internet: nadie de fuera debe poder apuntarnos ahí. */
function esIpPrivada(ip: string) {
  if (ip.includes(":")) {
    const v6 = ip.toLowerCase();
    // ::1 (loopback), fc00::/7 (privadas), fe80::/10 (enlace local).
    return v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith("::ffff:127.");
  }
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // enlace local y metadatos de la nube
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT
  );
}

/**
 * ¿Se puede descargar de aquí? Los bancos conocidos van por su lista de
 * dominios; los abiertos, por https + IP pública. La comprobación se repite en
 * cada redirección, que es por donde se cuelan estas cosas.
 */
export async function destinoAdmitido(u: URL, abierto: boolean) {
  if (u.protocol !== "https:") throw new Error(`Solo https: ${u.protocol}//${u.hostname}`);
  if (!abierto) {
    if (!hostPermitido(u)) throw new Error(`Dominio no permitido: ${u.hostname}`);
    return;
  }
  const { lookup } = await import("node:dns/promises");
  const direcciones = await lookup(u.hostname, { all: true }).catch(() => []);
  if (!direcciones.length) throw new Error(`No se pudo resolver ${u.hostname}`);
  if (direcciones.some((d) => esIpPrivada(d.address))) {
    throw new Error(`Dominio que apunta a la red interna: ${u.hostname}`);
  }
}

/** Descarga el archivo de un clip aplicando la política de su banco. */
export const descargarDeClip = (clip: Pick<ClipInfo, "url" | "fuente" | "tipo">, destino: string) =>
  descargarClip(clip.url, destino, { abierto: esOrigenAbierto(clip.fuente), tipo: clip.tipo });

export async function descargarClip(
  url: string,
  destino: string,
  o: { abierto?: boolean; tipo?: TipoMedio } = {},
) {
  let actual = new URL(url);
  for (let saltos = 0; saltos < 4; saltos++) {
    await destinoAdmitido(actual, Boolean(o.abierto));
    // Wikimedia y Archive responden 400 a quien no se identifica; los demas
    // no se quejan, asi que la cabecera va siempre.
    const res = await fetch(actual, {
      redirect: "manual",
      headers: { "User-Agent": AGENTE_DESCARGA },
      signal: AbortSignal.timeout(90_000),
    });
    const destinoRedir = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && destinoRedir) {
      actual = new URL(destinoRedir, actual); // la redireccion tambien pasa por la comprobacion
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status})`);
    // En origen abierto, lo que llega tiene que ser lo que se pidio: una
    // pagina de error HTML no puede acabar guardada como si fuera una foto.
    const tipo = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (o.abierto && !new RegExp(`^${o.tipo === "video" ? "video" : "image"}/`).test(tipo)) {
      throw new Error(`El servidor devolvio ${tipo || "un tipo desconocido"} en vez de ${o.tipo ?? "imagen"}`);
    }
    if (Number(res.headers.get("content-length") ?? 0) > MAX_CLIP_BYTES) {
      throw new Error(`Clip demasiado grande (limite ${env.MAX_CLIP_MB} MB, MAX_CLIP_MB)`);
    }

    let bytes = 0;
    const limite = new Transform({
      transform(trozo, _enc, cb) {
        bytes += trozo.length;
        bytes > MAX_CLIP_BYTES
          ? cb(new Error(`Clip demasiado grande (limite ${env.MAX_CLIP_MB} MB, MAX_CLIP_MB)`))
          : cb(null, trozo);
      },
    });
    await pipeline(
      Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]),
      limite,
      createWriteStream(destino),
    );
    return;
  }
  throw new Error("Demasiadas redirecciones");
}

export type Candidato = { info: ClipInfo; alto: number; ancho: number };

/**
 * El porqué del fallo, no solo el número. Pixabay contesta en texto plano
 * ("[ERROR 400] \"key\" is invalid"), que es justo lo que hace falta leer para
 * arreglarlo; un 400 a secas no dice nada.
 */
async function motivo(banco: string, res: Response) {
  const cuerpo = await res.text().catch(() => "");
  const limpio = cuerpo.replace(/\s+/g, " ").trim().slice(0, 120);
  return `${banco} respondio ${res.status}${limpio ? `: ${limpio}` : ""}`;
}

/** Prioriza vertical y la mayor resolucion que no sea desmesurada. */
function puntuar(c: Candidato) {
  const vertical = c.alto >= c.ancho ? 1000 : 0;
  return vertical + Math.min(c.alto, 1920);
}

async function buscarPexels(keyword: string, largos: boolean): Promise<Candidato[]> {
  if (!env.PEXELS_API_KEY) return [];
  const url = new URL("https://api.pexels.com/videos/search");
  url.search = new URLSearchParams({
    query: keyword,
    orientation: "portrait",
    size: "medium",
    per_page: "20",
    // Pexels filtra por duracion en origen; asi los largos vienen de serie.
    ...(largos ? { min_duration: String(CLIP_LARGO - 5) } : {}),
  }).toString();

  const res = await fetch(url, {
    headers: { Authorization: env.PEXELS_API_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(await motivo("Pexels", res));
  const data = await leerJSON(res);

  const salida: Candidato[] = [];
  for (const v of data.videos ?? []) {
    const archivos = (v.video_files ?? []).filter(
      (f: { file_type?: string; link?: string }) => f.file_type === "video/mp4" && f.link,
    );
    if (!archivos.length) continue;
    const mejor = archivos.sort(
      (a: { height: number }, b: { height: number }) => (b.height ?? 0) - (a.height ?? 0),
    )[0];
    salida.push({
      alto: mejor.height ?? 0,
      ancho: mejor.width ?? 0,
      info: {
        id: `pexels-${v.id}`,
        fuente: "pexels",
        tipo: "video",
        autor: v.user?.name ?? "Pexels",
        pagina: v.url ?? "https://www.pexels.com",
        licencia: "Pexels License",
        url: mejor.link,
        imagen: v.image,
        duracion: typeof v.duration === "number" ? v.duration : undefined,
      },
    });
  }
  return salida;
}

async function buscarPixabay(keyword: string): Promise<Candidato[]> {
  // Pixabay no filtra por duracion: se ordena despues con la que devuelve.
  if (!env.PIXABAY_API_KEY) return [];
  const url = new URL("https://pixabay.com/api/videos/");
  url.search = new URLSearchParams({
    key: env.PIXABAY_API_KEY,
    q: keyword,
    per_page: "15",
    safesearch: "true",
  }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(await motivo("Pixabay", res));
  const data = await leerJSON(res);

  const salida: Candidato[] = [];
  for (const h of data.hits ?? []) {
    const variantes = Object.values(h.videos ?? {}) as {
      url?: string;
      width?: number;
      height?: number;
      thumbnail?: string;
    }[];
    const mejor = variantes
      .filter((v) => v.url)
      .sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
    if (!mejor?.url) continue;
    salida.push({
      alto: mejor.height ?? 0,
      ancho: mejor.width ?? 0,
      info: {
        id: `pixabay-${h.id}`,
        fuente: "pixabay",
        tipo: "video",
        autor: h.user ?? "Pixabay",
        pagina: h.pageURL ?? "https://pixabay.com",
        licencia: "Pixabay Content License",
        url: mejor.url,
        imagen: variantes.find((v) => v.thumbnail)?.thumbnail,
        duracion: typeof h.duration === "number" ? h.duration : undefined,
      },
    });
  }
  return salida;
}

/** Fotos de Pexels. Verticales, que es lo que pide el lienzo de 9:16. */
async function buscarPexelsFotos(keyword: string): Promise<Candidato[]> {
  if (!env.PEXELS_API_KEY) return [];
  const url = new URL("https://api.pexels.com/v1/search");
  url.search = new URLSearchParams({
    query: keyword,
    orientation: "portrait",
    per_page: "15",
  }).toString();

  const res = await fetch(url, {
    headers: { Authorization: env.PEXELS_API_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(await motivo("Pexels", res));
  const data = await leerJSON(res);

  const salida: Candidato[] = [];
  for (const f of data.photos ?? []) {
    const enlace = f.src?.large2x ?? f.src?.original ?? f.src?.large;
    if (!enlace) continue;
    salida.push({
      alto: f.height ?? 0,
      ancho: f.width ?? 0,
      info: {
        id: `pexels-foto-${f.id}`,
        fuente: "pexels",
        tipo: "imagen",
        autor: f.photographer ?? "Pexels",
        pagina: f.url ?? "https://www.pexels.com",
        licencia: "Pexels License",
        url: enlace,
        imagen: f.src?.medium ?? enlace,
      },
    });
  }
  return salida;
}

/** Fotos de Pixabay. */
async function buscarPixabayFotos(keyword: string): Promise<Candidato[]> {
  if (!env.PIXABAY_API_KEY) return [];
  const url = new URL("https://pixabay.com/api/");
  url.search = new URLSearchParams({
    key: env.PIXABAY_API_KEY,
    q: keyword,
    image_type: "photo",
    orientation: "vertical",
    per_page: "15",
    safesearch: "true",
  }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(await motivo("Pixabay", res));
  const data = await leerJSON(res);

  const salida: Candidato[] = [];
  for (const h of data.hits ?? []) {
    const enlace = h.largeImageURL ?? h.webformatURL;
    if (!enlace) continue;
    salida.push({
      alto: h.imageHeight ?? 0,
      ancho: h.imageWidth ?? 0,
      info: {
        id: `pixabay-foto-${h.id}`,
        fuente: "pixabay",
        tipo: "imagen",
        autor: h.user ?? "Pixabay",
        pagina: h.pageURL ?? "https://pixabay.com",
        licencia: "Pixabay Content License",
        url: enlace,
        imagen: h.previewURL ?? enlace,
      },
    });
  }
  return salida;
}

/**
 * Imágenes y vídeos de la NASA (images.nasa.gov). No pide clave y su material
 * es de dominio público: es la fuente natural de los cuentos de ciencia,
 * espacio y planetas, donde Pexels solo ofrece animaciones genéricas.
 *
 * La búsqueda devuelve fichas, no archivos: el enlace real está en el
 * `collection.json` de cada ficha, que hay que pedir aparte.
 */
const NASA_ITEMS = 6;

/** Prioridad de tamaño: ni el original gigante ni la miniatura. */
const ORDEN_NASA = {
  video: ["~large.mp4", "~medium.mp4", "~mobile.mp4", "~small.mp4"],
  imagen: ["~orig.jpg", "~large.jpg", "~medium.jpg", "~orig.png", "~small.jpg"],
} as const;

const aHttps = (u: string) => u.replace(/^http:/, "https:");

async function archivoNasa(href: string, tipo: TipoMedio): Promise<string | null> {
  const res = await fetch(aHttps(href), { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return null;
  const lista = (await res.json()) as unknown;
  if (!Array.isArray(lista)) return null;
  const archivos = lista.filter((x): x is string => typeof x === "string").map(aHttps);
  for (const sufijo of ORDEN_NASA[tipo]) {
    const encontrado = archivos.find((a) => a.toLowerCase().endsWith(sufijo));
    if (encontrado) return encontrado;
  }
  return null;
}

/**
 * Una búsqueda por tipo, no una mezclada: pidiendo "image,video" la NASA
 * devuelve primero un muro de fotos y los vídeos no llegan nunca.
 */
async function buscarNasa(keyword: string, medios: TipoMedio[]): Promise<Candidato[]> {
  const listas = await Promise.all(medios.map((m) => buscarNasaTipo(keyword, m).catch(() => [])));
  // Intercalados: así el vídeo no se queda detrás de seis fotos.
  const salida: Candidato[] = [];
  for (let i = 0; i < NASA_ITEMS; i++) for (const lista of listas) if (lista[i]) salida.push(lista[i]);
  return salida;
}

async function buscarNasaTipo(keyword: string, tipoPedido: TipoMedio): Promise<Candidato[]> {
  const url = new URL("https://images-api.nasa.gov/search");
  url.search = new URLSearchParams({
    q: keyword,
    media_type: tipoPedido === "imagen" ? "image" : "video",
    page_size: "20",
  }).toString();
  const medios = [tipoPedido];

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(await motivo("NASA", res));
  const data = await leerJSON(res);
  const fichas = (data.collection?.items ?? []).slice(0, NASA_ITEMS);

  const candidatos = await Promise.all(
    fichas.map(async (ficha: { href?: string; links?: { href?: string }[]; data?: Record<string, string>[] }) => {
      const d = ficha.data?.[0];
      if (!d?.nasa_id || !ficha.href) return null;
      const tipo: TipoMedio = d.media_type === "image" ? "imagen" : "video";
      if (!medios.includes(tipo)) return null;
      const enlace = await archivoNasa(ficha.href, tipo).catch(() => null);
      if (!enlace) return null;
      const muestra = ficha.links?.find((l) => l.href)?.href;
      return {
        // Sin dimensiones en la ficha: puntuación neutra, por detrás de un
        // vertical de verdad y por delante de un horizontal cualquiera.
        alto: 700,
        ancho: 700,
        info: {
          id: `nasa-${d.nasa_id}`,
          fuente: "nasa" as const,
          tipo,
          autor: d.center ? `NASA/${d.center}` : "NASA",
          pagina: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
          licencia: "Dominio público (NASA)",
          url: enlace,
          imagen: muestra ? aHttps(muestra) : undefined,
        },
      } satisfies Candidato;
    }),
  );
  return candidatos.filter((c): c is Candidato => c !== null);
}

/**
 * Busca material. Con `largos`, los clips de 30 s o mas van primero (y a
 * Pexels se le pide directamente que no mande cortos): sirve para cubrir
 * narraciones enteras sin cambiar de plano cada cuatro segundos. `bancos` y
 * `medios` deciden dónde se busca y si entran fotos además de vídeos.
 */
export async function buscarClips(keyword: string, o: OpcionesMedios = {}): Promise<ClipInfo[]> {
  return (await buscarConEstado(keyword, o)).clips;
}

/** Cómo le fue a cada banco: cuántos trajo y, si falló, por qué. */
export type EstadoBanco = { banco: Banco; encontrados: number; error?: string };

export type Busqueda = { clips: ClipInfo[]; bancos: EstadoBanco[] };

/**
 * Igual que `buscarClips`, pero contando qué hizo cada banco. Un banco que
 * falla en silencio es el peor error posible de esta pantalla: se ve una
 * búsqueda vacía y no hay forma de saber si es que no hay material, si la
 * clave está mal o si el banco devolvió un 429.
 */
export async function buscarConEstado(keyword: string, o: OpcionesMedios = {}): Promise<Busqueda> {
  const largos = o.largos ?? false;
  const disponibles = bancosDisponibles();
  const bancos = (o.bancos?.length ? o.bancos : disponibles).filter((b) => disponibles.includes(b));
  const medios = o.medios?.length ? o.medios : (["video"] as TipoMedio[]);
  const clave = `clips:v3:${bancos.join("+")}:${medios.join("+")}:${largos ? "largos:" : ""}${keyword
    .toLowerCase()
    .trim()}`;

  return buscarConCache(
    clave,
    async () => {
      const conVideo = medios.includes("video");
      const conImagen = medios.includes("imagen");

      /** Lanza las búsquedas de un banco y se queda con el primer error. */
      const pedir = async (banco: Banco, tareas: Promise<Candidato[]>[]): Promise<[EstadoBanco, Candidato[]]> => {
        const resultados = await Promise.all(
          tareas.map((t) => t.then((r) => ({ r }), (e: unknown) => ({ e: e instanceof Error ? e.message : String(e) }))),
        );
        const encontrados = resultados.flatMap((x) => ("r" in x ? x.r : []));
        const error = resultados.find((x) => "e" in x) as { e: string } | undefined;
        return [{ banco, encontrados: encontrados.length, ...(error ? { error: error.e } : {}) }, encontrados];
      };

      const porBanco: Promise<[EstadoBanco, Candidato[]]>[] = [];
      if (bancos.includes("pexels")) {
        porBanco.push(
          pedir("pexels", [
            ...(conVideo ? [buscarPexels(keyword, largos)] : []),
            ...(conImagen ? [buscarPexelsFotos(keyword)] : []),
          ]),
        );
      }
      if (bancos.includes("pixabay")) {
        porBanco.push(
          pedir("pixabay", [
            ...(conVideo ? [buscarPixabay(keyword)] : []),
            ...(conImagen ? [buscarPixabayFotos(keyword)] : []),
          ]),
        );
      }
      if (bancos.includes("nasa")) porBanco.push(pedir("nasa", [buscarNasa(keyword, medios)]));
      // Los tres abiertos: sin clave, con la licencia de cada pieza dentro.
      if (bancos.includes("openverse")) porBanco.push(pedir("openverse", [buscarOpenverse(keyword, medios)]));
      if (bancos.includes("wikimedia")) porBanco.push(pedir("wikimedia", [buscarWikimedia(keyword, medios)]));
      if (bancos.includes("archive")) porBanco.push(pedir("archive", [buscarArchive(keyword, medios)]));

      const resultados = await Promise.all(porBanco);
      const todos = resultados.flatMap(([, cs]) => cs);
      const esLargo = (c: Candidato) => (c.info.duracion ?? 0) >= CLIP_LARGO;
      const esVideo = (c: Candidato) => c.info.tipo === "video";
      return {
        clips: todos
          .sort((a, b) => {
            // Un vídeo manda sobre una foto: la foto se anima, pero no se mueve sola.
            if (conVideo && conImagen && esVideo(a) !== esVideo(b)) return Number(esVideo(b)) - Number(esVideo(a));
            if (largos && esLargo(a) !== esLargo(b)) return Number(esLargo(b)) - Number(esLargo(a));
            return puntuar(b) - puntuar(a);
          })
          .map((c) => c.info),
        bancos: resultados.map(([estado]) => estado),
      };
    },
    (r) => (r.bancos.some((b) => b.error) ? CACHE_FALLO_SEG : CACHE_SEG),
  );
}

/**
 * Elige un clip por escena sin descargar nada: solo enlaces. Es lo que usa el
 * editor para precargar la linea de tiempo y dejar mirar antes de bajar.
 * Devuelve null donde no encontro nada, para que la escena quede en color.
 */
export async function elegirClips(
  escenas: { keywords: string[] }[],
  usados: Set<string> = new Set(),
  /** Clip elegido a mano por escena: indice -> id de clip. */
  preseleccion: Record<number, string> = {},
  medios: OpcionesMedios = {},
): Promise<(ClipInfo | null)[]> {
  const yaElegidos = new Set(usados);
  const salida: (ClipInfo | null)[] = [];

  for (const [i, escena] of escenas.entries()) {
    let elegido: ClipInfo | undefined;
    // Si todos los candidatos estan repetidos, mejor uno repetido que ninguno.
    let respaldo: ClipInfo | undefined;

    for (const keyword of escena.keywords) {
      const candidatos = await buscarClips(keyword, medios);
      respaldo ??= candidatos[0];

      // El id elegido a mano se resuelve contra la busqueda, no se acepta la
      // URL que mande el navegador: asi no hay forma de colar una direccion.
      const aMano = preseleccion[i];
      if (aMano) {
        const encontrado = candidatos.find((c) => c.id === aMano);
        if (encontrado) {
          elegido = encontrado;
          break;
        }
        continue;
      }

      elegido = candidatos.find((c) => !yaElegidos.has(c.id));
      if (elegido) break;
    }
    elegido ??= respaldo;
    if (elegido) yaElegidos.add(elegido.id);
    salida.push(elegido ?? null);
  }
  return salida;
}

/**
 * Elige y ademas descarga a la carpeta de trabajo (Pixabay no permite enlazar
 * en caliente). Falla si alguna escena se queda sin clip: el render automatico
 * no tiene con que rellenar.
 */
export async function elegirYDescargarClips(
  escenas: { texto: string; keywords: string[] }[],
  dir: string,
  usados: Set<string> = new Set(),
  preseleccion: Record<number, string> = {},
  medios: OpcionesMedios = {},
): Promise<EscenaPreparada[]> {
  const elegidos = await elegirClips(escenas, usados, preseleccion, medios);
  const preparadas: EscenaPreparada[] = [];

  for (const [i, escena] of escenas.entries()) {
    const elegido = elegidos[i];
    if (!elegido) {
      throw new Error(
        `Sin material para la escena ${i + 1} (${escena.keywords.join(", ")}). ` +
          "Revisa PEXELS_API_KEY / PIXABAY_API_KEY, prueba con otras keywords o " +
          "amplía los bancos (la NASA no necesita clave) y admite fotos además de vídeos.",
      );
    }
    const archivo = `clip${i}${extensionMedio(elegido)}`;
    await descargarDeClip(elegido, join(dir, archivo));
    preparadas.push({ texto: escena.texto, keywords: escena.keywords, clip: elegido, archivo });
  }

  return preparadas;
}

/**
 * Creditos de los clips usados, sin repetir: fuente, autor, pagina y licencia.
 * Es lo que hay que pegar en TikTok junto a la descripcion.
 */
export function creditosDe(escenas: Pick<EscenaPreparada, "clip">[]): string {
  return creditosLargos(escenas.filter((e) => e?.clip).map((e) => e.clip));
}

type ClipAcreditable = Pick<ClipInfo, "id" | "fuente" | "autor" | "pagina" | "licencia">;

const NOMBRE_FUENTE: Record<Fuente, string> = {
  pexels: "Pexels",
  pixabay: "Pixabay",
  nasa: "NASA",
  openverse: "Openverse",
  wikimedia: "Wikimedia Commons",
  archive: "Internet Archive",
  subido: "propio",
  amazon: "Amazon",
};

/**
 * Lo que no va en la linea de creditos: el material propio no tiene a quien
 * acreditar, y el producto de Amazon lleva su propio bloque en la descripcion,
 * con el enlace de afiliado y la divulgacion.
 */
const SIN_CREDITO: Fuente[] = ["subido", "amazon"];

const unicos = (clips: ClipAcreditable[]) => [...new Map(clips.map((c) => [c.id, c])).values()];

/** Lista completa, un clip por línea con su enlace: para el .txt y los comentarios. */
export function creditosLargos(clips: ClipAcreditable[]): string {
  return unicos(clips)
    .filter((c) => !SIN_CREDITO.includes(c.fuente))
    .map((c) => `${c.autor} (${NOMBRE_FUENTE[c.fuente]}, ${c.licencia}) - ${c.pagina}`)
    .join("\n");
}

/**
 * Créditos en una sola línea, agrupados por fuente: "Clips: Pexels (Ana, Luis) · Pixabay (Pedro)".
 * Es lo que va en la descripción para publicar, donde cada carácter cuenta.
 */
export function creditosCortos(clips: ClipAcreditable[]): string {
  const porFuente = new Map<Fuente, Set<string>>();
  for (const c of unicos(clips).filter((c) => !SIN_CREDITO.includes(c.fuente))) {
    const autores = porFuente.get(c.fuente) ?? new Set<string>();
    autores.add(c.autor.trim());
    porFuente.set(c.fuente, autores);
  }
  if (!porFuente.size) return "";
  const partes = [...porFuente.entries()].map(([fuente, autores]) => {
    const lista = [...autores];
    const visibles = lista.slice(0, 4).join(", ");
    const resto = lista.length > 4 ? ` y ${lista.length - 4} más` : "";
    return `${NOMBRE_FUENTE[fuente]} (${visibles}${resto})`;
  });
  return `Clips: ${partes.join(" · ")}`;
}

/**
 * Une el gancho de la publicación, el del vídeo, los hashtags y los créditos
 * cortos en la descripción para publicar.
 *
 * La primera línea es lo único que se ve antes del "ver más", así que va el
 * gancho VIRAL —el que se escribe para leer, no para escuchar— y debajo el
 * gancho narrado, que da el contexto.
 */
export function armarDescripcion(
  cabecera: string,
  hashtags: string[],
  clips: ClipAcreditable[],
  musica?: string | null,
  ganchos: string[] = [],
): string {
  const etiquetas = [...new Set(hashtags.map((h) => h.replace(/^#/, "").trim()).filter(Boolean))]
    .slice(0, 6)
    .map((h) => `#${h}`)
    .join(" ");
  const viral = ganchos.map((g) => g.trim()).find(Boolean) ?? "";
  // Si el gancho viral y el del vídeo dicen lo mismo, no se repite.
  const parecidos = viral && cabecera.trim().toLowerCase() === viral.toLowerCase();
  return [viral, parecidos ? "" : cabecera.trim(), etiquetas, creditosCortos(clips), musica ?? "", "Contenido creado con IA."]
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Descripcion lista para pegar en TikTok, con los creditos cortos de los clips. */
export function crearDescripcion(
  guion: { titulo: string; gancho?: string; hashtags?: string[]; ganchos?: string[] },
  escenas: EscenaPreparada[],
  musica?: string | null,
): string {
  return armarDescripcion(
    guion.gancho ?? guion.titulo,
    guion.hashtags ?? [],
    escenas.filter((e) => e?.clip).map((e) => e.clip),
    musica,
    guion.ganchos ?? [],
  );
}

export async function cerrarRedisClips() {
  await redis.quit();
}
