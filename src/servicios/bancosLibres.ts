import { leerJSON } from "../util/http.js";
import { env } from "../env.js";
import type { Candidato, TipoMedio } from "./clips.js";

/**
 * Los tres bancos abiertos: Openverse, Wikimedia Commons e Internet Archive.
 *
 * Ninguno pide clave, y los tres traen la licencia de cada pieza, que es lo
 * que permite acreditarla bien. A cambio hay que trabajar más: cada uno sirve
 * los archivos desde donde quiere y cuenta la licencia a su manera, así que
 * aquí se normaliza todo a la misma ficha que usan Pexels o la NASA.
 */

/** Wikimedia y Archive piden identificarse; un agente genérico les molesta. */
const AGENTE = "estudio-voz-en-off/1.0 (https://github.com/jseborga/historia-ramdom)";

const cabeceras = { "User-Agent": AGENTE, Accept: "application/json" };

const aHttps = (u: string) => u.replace(/^http:/, "https:");

/** Los títulos y autores vienen con HTML en Wikimedia; se lee en un rótulo. */
const sinHtml = (v: string) =>
  v
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

// ---------------------------------------------------------------- Openverse

/**
 * Openverse (WordPress): cientos de millones de imágenes con licencia libre,
 * de Flickr, museos, archivos y la propia Wikimedia.
 *
 * Se piden solo las que se pueden usar **comercialmente y modificar**: lo que
 * sale de aquí se recorta, se anima y se publica, así que una licencia "no
 * comercial" no vale de nada.
 *
 * Sin registrar, la API deja 20 peticiones por minuto y 200 al día; con la
 * caché de un día llega de sobra para buscar a mano. `OPENVERSE_TOKEN` sube
 * ese límite si algún día hace falta.
 */
export async function buscarOpenverse(keyword: string, medios: TipoMedio[]): Promise<Candidato[]> {
  // Openverse no tiene vídeo: si solo se pide vídeo, no hay nada que buscar.
  if (!medios.includes("imagen")) return [];

  const url = new URL("https://api.openverse.org/v1/images/");
  url.search = new URLSearchParams({
    q: keyword,
    page_size: "15",
    license_type: "commercial,modification",
    mature: "false",
  }).toString();

  const res = await fetch(url, {
    headers: env.OPENVERSE_TOKEN
      ? { ...cabeceras, Authorization: `Bearer ${env.OPENVERSE_TOKEN}` }
      : cabeceras,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(await motivo("Openverse", res));
  const data = await leerJSON(res);

  const salida: Candidato[] = [];
  for (const r of data.results ?? []) {
    if (!r.url || !r.id) continue;
    const licencia = [r.license, r.license_version].filter(Boolean).join(" ").toUpperCase();
    salida.push({
      alto: r.height ?? 0,
      ancho: r.width ?? 0,
      info: {
        id: `openverse-${r.id}`,
        fuente: "openverse",
        tipo: "imagen",
        autor: sinHtml(String(r.creator ?? r.provider ?? "Openverse")).slice(0, 120),
        pagina: r.foreign_landing_url ?? `https://openverse.org/image/${r.id}`,
        licencia: licencia ? `CC ${licencia}` : "Licencia libre (Openverse)",
        url: aHttps(r.url),
        // La miniatura la sirve la propia Openverse: un solo dominio en vez
        // de los cien de los proveedores originales.
        imagen: r.thumbnail ?? undefined,
      },
    });
  }
  return salida;
}

// -------------------------------------------------------- Wikimedia Commons

/** Extrae un campo de `extmetadata`, que llega envuelto en `{ value }`. */
const meta = (em: Record<string, { value?: string }> | undefined, clave: string) =>
  em?.[clave]?.value ? sinHtml(String(em[clave].value)) : "";

/**
 * Wikimedia Commons: el archivo de referencia para todo lo histórico,
 * artístico y documental —retratos de autores, cuadros, mapas, primeras
 * ediciones—, que es justo lo que pide el área de ideas.
 *
 * Devuelve imágenes y también vídeo (webm y ogv); del vídeo solo se admite lo
 * que ffmpeg reproduce sin sorpresas.
 */
export async function buscarWikimedia(keyword: string, medios: TipoMedio[]): Promise<Candidato[]> {
  const tipos = [
    ...(medios.includes("imagen") ? ["bitmap"] : []),
    ...(medios.includes("video") ? ["video"] : []),
  ];
  if (!tipos.length) return [];

  const listas = await Promise.all(tipos.map((t) => buscarEnCommons(keyword, t)));
  return listas.flat();
}

async function buscarEnCommons(keyword: string, filetype: string): Promise<Candidato[]> {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.search = new URLSearchParams({
    action: "query",
    format: "json",
    generator: "search",
    gsrsearch: `filetype:${filetype} ${keyword}`,
    gsrlimit: "12",
    // Espacio 6 = "File:"; sin esto salen artículos, no archivos.
    gsrnamespace: "6",
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: "480",
  }).toString();

  const res = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(await motivo("Wikimedia", res));
  const data = await leerJSON(res);

  const salida: Candidato[] = [];
  for (const pagina of Object.values(data.query?.pages ?? {}) as Record<string, unknown>[]) {
    const ii = (pagina.imageinfo as Record<string, unknown>[] | undefined)?.[0];
    if (!ii?.url) continue;
    const mime = String(ii.mime ?? "");
    const esImagen = /^image\/(jpeg|png|webp)$/.test(mime);
    // Ogg Theora no lo toca nadie ya; webm y mp4 sí.
    const esVideo = /^video\/(webm|mp4)$/.test(mime);
    if (!esImagen && !esVideo) continue;

    const em = ii.extmetadata as Record<string, { value?: string }> | undefined;
    const licencia = meta(em, "LicenseShortName") || "Ver la ficha en Commons";
    const autor = meta(em, "Artist") || meta(em, "Credit") || "Wikimedia Commons";
    salida.push({
      alto: Number(ii.height ?? 0),
      ancho: Number(ii.width ?? 0),
      info: {
        id: `wikimedia-${String(pagina.pageid ?? pagina.title)}`,
        fuente: "wikimedia",
        tipo: esImagen ? "imagen" : "video",
        autor: autor.slice(0, 120),
        pagina: String(ii.descriptionurl ?? "https://commons.wikimedia.org"),
        licencia: licencia.slice(0, 80),
        url: aHttps(String(ii.url)),
        imagen: ii.thumburl ? aHttps(String(ii.thumburl)) : undefined,
        duracion: typeof ii.duration === "number" ? ii.duration : undefined,
      },
    });
  }
  return salida;
}

// --------------------------------------------------------- Internet Archive

/** Formatos de Archive que valen, del más manejable al más pesado. */
const FORMATOS_VIDEO = ["h.264", "MPEG4", "512Kb MPEG4", "HiRes MPEG4", "MPEG2"];
const FORMATOS_IMAGEN = ["JPEG", "PNG", "JPEG Thumb", "Item Tile"];

/**
 * Internet Archive: cine y noticiarios de dominio público, material de
 * archivo de verdad para historias y miniseries.
 *
 * Van dos peticiones por resultado —la búsqueda da identificadores y la ficha
 * da los archivos—, así que se piden pocos y se cachean como todo lo demás.
 */
const ITEMS_ARCHIVE = 5;

export async function buscarArchive(keyword: string, medios: TipoMedio[]): Promise<Candidato[]> {
  const tipos = [
    ...(medios.includes("video") ? ["movies"] : []),
    ...(medios.includes("imagen") ? ["image"] : []),
  ];
  if (!tipos.length) return [];

  const url = new URL("https://archive.org/advancedsearch.php");
  // Buscar en título y descripción, no en todo el texto del item: Archive es
  // un archivo general y una búsqueda suelta trae de todo (para "saturn",
  // capturas de consolas). Y primero lo más visto, que suele ser lo mejor.
  const limpia = keyword.replace(/["\\()]/g, " ").trim();
  const consulta =
    `(title:(${limpia}) OR description:(${limpia})) AND mediatype:(${tipos.join(" OR ")}) ` +
    // Solo lo que declara licencia: sin eso no se puede acreditar ni publicar.
    "AND licenseurl:(*)";
  url.search = new URLSearchParams({
    q: consulta,
    "fl[]": "identifier",
    rows: String(ITEMS_ARCHIVE),
    page: "1",
    output: "json",
  }).toString();
  // `fl[]` se repite; URLSearchParams solo deja uno, así que se añaden aparte.
  for (const campo of ["title", "creator", "licenseurl", "mediatype"]) url.searchParams.append("fl[]", campo);
  url.searchParams.append("sort[]", "downloads desc");

  const res = await fetch(url, { headers: cabeceras, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(await motivo("Internet Archive", res));
  const data = await leerJSON(res);
  const docs = (data.response?.docs ?? []) as Record<string, unknown>[];

  const candidatos = await Promise.all(docs.map((d) => archivoDeItem(d).catch(() => null)));
  return candidatos.filter((c): c is Candidato => c !== null);
}

/** La ficha del item dice qué archivos tiene; se elige el mejor que quepa. */
async function archivoDeItem(doc: Record<string, unknown>): Promise<Candidato | null> {
  const id = String(doc.identifier ?? "");
  if (!id) return null;

  const res = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
    headers: cabeceras,
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) return null;
  const ficha = await leerJSON(res);
  const archivos = (ficha.files ?? []) as Record<string, unknown>[];

  const esVideo = String(doc.mediatype ?? "") === "movies";
  const orden = esVideo ? FORMATOS_VIDEO : FORMATOS_IMAGEN;
  const admitido = esVideo ? /\.(mp4|m4v|webm)$/i : /\.(jpe?g|png|webp)$/i;

  let elegido: Record<string, unknown> | null = null;
  for (const formato of orden) {
    const candidato = archivos.find(
      (f) =>
        f.format === formato &&
        admitido.test(String(f.name ?? "")) &&
        // Un archivo de 200 MB no entra en un clip: se descarta aquí y no al descargar.
        Number(f.size ?? 0) > 0 &&
        Number(f.size ?? 0) < 90 * 1024 * 1024,
    );
    if (candidato) {
      elegido = candidato;
      break;
    }
  }
  if (!elegido) return null;

  const licencia = String(doc.licenseurl ?? "");
  return {
    alto: 0,
    ancho: 0,
    info: {
      id: `archive-${id}`,
      fuente: "archive",
      tipo: esVideo ? "video" : "imagen",
      autor: sinHtml(String(doc.creator ?? "Internet Archive")).slice(0, 120),
      pagina: `https://archive.org/details/${encodeURIComponent(id)}`,
      licencia: nombreLicencia(licencia),
      url: `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(String(elegido.name))}`,
      imagen: `https://archive.org/services/img/${encodeURIComponent(id)}`,
      duracion: Number(elegido.length) > 0 ? Number(elegido.length) : undefined,
    },
  };
}

/** De la URL de la licencia al nombre corto que va en los créditos. */
export function nombreLicencia(url: string): string {
  const m = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)(?:\/([\d.]+))?/i.exec(url);
  if (!m) return url ? "Ver la licencia en la ficha" : "Sin licencia declarada";
  if (m[1] === "publicdomain") return m[2] === "zero" ? "CC0 1.0" : "Dominio público (marca PDM)";
  return `CC ${m[2].toUpperCase()}${m[3] ? ` ${m[3]}` : ""}`;
}

/** El porqué del fallo, no solo el número. */
async function motivo(banco: string, res: Response) {
  const cuerpo = await res.text().catch(() => "");
  const limpio = cuerpo.replace(/\s+/g, " ").trim().slice(0, 120);
  return `${banco} respondio ${res.status}${limpio ? `: ${limpio}` : ""}`;
}
