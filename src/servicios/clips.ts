import { createWriteStream } from "node:fs";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Redis } from "ioredis";
import { env, MAX_CLIP_BYTES } from "../env.js";
import { leerJSON } from "../util/http.js";

const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

/**
 * Solo se descargan archivos de los CDN de Pexels y Pixabay. Asi una URL
 * manipulada no puede hacer que el servidor acceda a direcciones internas (SSRF).
 */
const HOSTS_PERMITIDOS = new Set([
  "videos.pexels.com",
  "player.vimeo.com",
  "cdn.pixabay.com",
  "pixabay.com",
]);

export type ClipInfo = {
  id: string;
  fuente: "pexels" | "pixabay";
  autor: string;
  pagina: string;
  licencia: string;
  url: string;
};

export type EscenaPreparada = {
  texto: string;
  keywords: string[];
  clip: ClipInfo;
  archivo: string;
  audio?: string;
};

export async function buscarConCache<T>(clave: string, buscar: () => Promise<T>): Promise<T> {
  const guardado = await redis.get(clave);
  if (guardado) return JSON.parse(guardado) as T;
  const resultado = await buscar();
  // Pixabay exige cachear sus resultados 24 h; lo aplicamos tambien a Pexels.
  await redis.set(clave, JSON.stringify(resultado), "EX", 86_400);
  return resultado;
}

export async function descargarClip(url: string, destino: string) {
  let actual = new URL(url);
  for (let saltos = 0; saltos < 4; saltos++) {
    if (actual.protocol !== "https:" || !HOSTS_PERMITIDOS.has(actual.hostname)) {
      throw new Error(`Dominio no permitido: ${actual.hostname}`);
    }
    const res = await fetch(actual, { redirect: "manual", signal: AbortSignal.timeout(90_000) });
    const destinoRedir = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && destinoRedir) {
      actual = new URL(destinoRedir, actual); // la redireccion tambien pasa por la lista blanca
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status})`);
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

type Candidato = { info: ClipInfo; alto: number; ancho: number };

/** Prioriza vertical y la mayor resolucion que no sea desmesurada. */
function puntuar(c: Candidato) {
  const vertical = c.alto >= c.ancho ? 1000 : 0;
  return vertical + Math.min(c.alto, 1920);
}

async function buscarPexels(keyword: string): Promise<Candidato[]> {
  if (!env.PEXELS_API_KEY) return [];
  const url = new URL("https://api.pexels.com/videos/search");
  url.search = new URLSearchParams({
    query: keyword,
    orientation: "portrait",
    size: "medium",
    per_page: "15",
  }).toString();

  const res = await fetch(url, {
    headers: { Authorization: env.PEXELS_API_KEY },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Pexels respondio ${res.status}`);
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
        autor: v.user?.name ?? "Pexels",
        pagina: v.url ?? "https://www.pexels.com",
        licencia: "Pexels License",
        url: mejor.link,
      },
    });
  }
  return salida;
}

async function buscarPixabay(keyword: string): Promise<Candidato[]> {
  if (!env.PIXABAY_API_KEY) return [];
  const url = new URL("https://pixabay.com/api/videos/");
  url.search = new URLSearchParams({
    key: env.PIXABAY_API_KEY,
    q: keyword,
    per_page: "15",
    safesearch: "true",
  }).toString();

  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Pixabay respondio ${res.status}`);
  const data = await leerJSON(res);

  const salida: Candidato[] = [];
  for (const h of data.hits ?? []) {
    const variantes = Object.values(h.videos ?? {}) as {
      url?: string;
      width?: number;
      height?: number;
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
        autor: h.user ?? "Pixabay",
        pagina: h.pageURL ?? "https://pixabay.com",
        licencia: "Pixabay Content License",
        url: mejor.url,
      },
    });
  }
  return salida;
}

export async function buscarClips(keyword: string): Promise<ClipInfo[]> {
  const clave = `clips:${keyword.toLowerCase().trim()}`;
  return buscarConCache(clave, async () => {
    const [pexels, pixabay] = await Promise.all([
      buscarPexels(keyword).catch(() => []),
      buscarPixabay(keyword).catch(() => []),
    ]);
    return [...pexels, ...pixabay]
      .sort((a, b) => puntuar(b) - puntuar(a))
      .map((c) => c.info);
  });
}

/**
 * Busca un clip por escena, evitando los ya usados en historias recientes,
 * y lo descarga a la carpeta de trabajo (Pixabay no permite enlazar en caliente).
 */
export async function elegirYDescargarClips(
  escenas: { texto: string; keywords: string[] }[],
  dir: string,
  usados: Set<string> = new Set(),
): Promise<EscenaPreparada[]> {
  const yaElegidos = new Set(usados);
  const preparadas: EscenaPreparada[] = [];

  for (const [i, escena] of escenas.entries()) {
    let elegido: ClipInfo | undefined;
    // Si todos los candidatos estan repetidos, mejor uno repetido que ninguno.
    let respaldo: ClipInfo | undefined;

    for (const keyword of escena.keywords) {
      const candidatos = await buscarClips(keyword);
      respaldo ??= candidatos[0];
      elegido = candidatos.find((c) => !yaElegidos.has(c.id));
      if (elegido) break;
    }
    elegido ??= respaldo;

    if (!elegido) {
      throw new Error(
        `Sin clips para la escena ${i + 1} (${escena.keywords.join(", ")}). ` +
          "Revisa PEXELS_API_KEY / PIXABAY_API_KEY o cambia las keywords.",
      );
    }

    yaElegidos.add(elegido.id);
    const archivo = `clip${i}.mp4`;
    await descargarClip(elegido.url, join(dir, archivo));
    preparadas.push({ texto: escena.texto, keywords: escena.keywords, clip: elegido, archivo });
  }

  return preparadas;
}

/**
 * Creditos de los clips usados, sin repetir: fuente, autor, pagina y licencia.
 * Es lo que hay que pegar en TikTok junto a la descripcion.
 */
export function creditosDe(escenas: Pick<EscenaPreparada, "clip">[]): string {
  return [...new Map(escenas.filter((e) => e?.clip).map((e) => [e.clip.id, e.clip])).values()]
    .map((c) => `${c.autor} (${c.fuente}, ${c.licencia}) - ${c.pagina}`)
    .join("\n");
}

/** Descripcion lista para pegar en TikTok, con los creditos de cada clip. */
export function crearDescripcion(
  guion: { titulo: string; gancho?: string; hashtags?: string[] },
  escenas: EscenaPreparada[],
): string {
  const creditos = creditosDe(escenas);
  const hashtags = (guion.hashtags ?? []).map((h) => `#${h.replace(/^#/, "")}`).join(" ");

  return [
    guion.gancho ?? guion.titulo,
    hashtags,
    "",
    "Voz e imagenes generadas o editadas con herramientas de IA.",
    "Clips:",
    creditos,
  ]
    .join("\n")
    .trim();
}

export async function cerrarRedisClips() {
  await redis.quit();
}
