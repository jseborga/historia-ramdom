import { env } from "../env.js";
import { leerJSON } from "../util/http.js";
import { guardarIdeas } from "./banco.js";

/**
 * Reddit como DETECTOR DE TEMAS, nunca como fuente de texto.
 *
 * De cada post se guardan solo el titulo (que funciona como semilla de tema),
 * el subreddit, la puntuacion y el enlace. El cuerpo del post no se descarga ni
 * se guarda, y el guion siempre lo escribe el modelo desde cero: copiar un
 * relato ajeno en un video monetizado es un problema de derechos, y TikTok
 * ademas penaliza el contenido poco original.
 *
 * Ojo con los terminos de la API: el nivel gratuito es para uso NO comercial
 * (100 consultas por minuto por client id). Monetizar el canal es uso
 * comercial y requiere un acuerdo previo con Reddit.
 */

const OAUTH = "https://oauth.reddit.com";
const TOKEN = "https://www.reddit.com/api/v1/access_token";

export function redditConfigurado() {
  return Boolean(env.REDDIT_ACTIVO && env.REDDIT_CLIENT_ID && env.REDDIT_CLIENT_SECRET);
}

let cache: { token: string; expira: number } | null = null;

async function token() {
  if (cache && cache.expira > Date.now() + 60_000) return cache.token;

  const basic = Buffer.from(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`).toString(
    "base64",
  );
  const res = await fetch(TOKEN, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": env.REDDIT_USER_AGENT,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
    signal: AbortSignal.timeout(30_000),
  });
  const j = await leerJSON(res);
  if (!res.ok || !j?.access_token) {
    throw new Error(`Reddit no entrego el token: ${j?.error ?? res.status}`);
  }
  cache = { token: j.access_token, expira: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cache.token;
}

type PostReddit = {
  id: string;
  title: string;
  score: number;
  permalink: string;
  subreddit: string;
  over_18: boolean;
  stickied: boolean;
  is_video: boolean;
};

async function topDe(sub: string, acceso: string): Promise<PostReddit[]> {
  const url = new URL(`${OAUTH}/r/${encodeURIComponent(sub)}/top`);
  url.search = new URLSearchParams({ t: "day", limit: "25" }).toString();

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${acceso}`, "User-Agent": env.REDDIT_USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Reddit respondio ${res.status} en r/${sub}`);
  const j = await leerJSON(res);
  return (j?.data?.children ?? []).map((c: { data: PostReddit }) => c.data);
}

const subs = (lista: string) =>
  lista
    .split(",")
    .map((s) => s.trim().replace(/^r\//, ""))
    .filter(Boolean);

/** Busca temas virales del dia y los deja en el banco como ideas pendientes. */
export async function buscarIdeasEnReddit() {
  if (!redditConfigurado()) {
    return { nuevas: 0, motivo: "Reddit desactivado o sin credenciales" };
  }

  const acceso = await token();
  let nuevas = 0;

  for (const [idioma, lista] of [
    ["es", env.REDDIT_SUBS_ES],
    ["en", env.REDDIT_SUBS_EN],
  ] as const) {
    for (const sub of subs(lista)) {
      const posts = await topDe(sub, acceso).catch(() => [] as PostReddit[]);
      const utiles = posts.filter(
        (p) =>
          !p.over_18 &&
          !p.stickied &&
          !p.is_video &&
          p.score >= env.REDDIT_PUNTOS_MINIMOS &&
          p.title.length >= 15 &&
          p.title.length <= 180,
      );

      nuevas += await guardarIdeas(
        utiles.map((p) => ({
          // El titulo es la semilla del tema; el texto del post no se toca.
          titulo: p.title,
          tema: p.title,
          idioma,
          refExterna: `https://www.reddit.com${p.permalink}`,
          notas: `r/${p.subreddit} · ${p.score} puntos`,
        })),
        "REDDIT",
      );
    }
  }

  return { nuevas };
}
