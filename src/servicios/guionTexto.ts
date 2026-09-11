import { GuionSchema, type Guion } from "./guion.js";

/**
 * El guion como texto plano, para sacarlo de la app, pasarlo por otra IA o
 * reescribirlo a mano, y volver a meterlo.
 *
 * El formato es deliberadamente simple y el lector es tolerante: acepta
 * mayusculas o minusculas, con acentos o sin ellos, y el separador `---`
 * con o sin el rotulo de escena.
 */

const PLANTILLA = `TITULO: {titulo}
GANCHO: {gancho}
HASHTAGS: {hashtags}
`;

export function guionATexto(guion: Guion): string {
  const cabecera = PLANTILLA.replace("{titulo}", guion.titulo)
    .replace("{gancho}", guion.gancho)
    .replace("{hashtags}", guion.hashtags.join(", "));

  const escenas = guion.escenas
    .map(
      (e, i) => `--- Escena ${i + 1}
${e.texto}
CLIPS: ${e.keywords.join(", ")}`,
    )
    .join("\n\n");

  return `${cabecera}\n${escenas}\n`;
}

/** Quita acentos y mayusculas para reconocer las etiquetas de forma laxa. */
const normalizar = (v: string) =>
  v
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();

/** Separa `ETIQUETA: valor` cuando la linea empieza por una etiqueta conocida. */
function etiqueta(linea: string, nombres: string[]) {
  const corte = linea.indexOf(":");
  if (corte === -1) return null;
  const clave = normalizar(linea.slice(0, corte));
  if (!nombres.includes(clave)) return null;
  return linea.slice(corte + 1).trim();
}

const listaDe = (v: string) =>
  v
    .split(",")
    .map((x) => x.trim().replace(/^#/, ""))
    .filter(Boolean);

export function textoAGuion(texto: string): Guion {
  const bloques = texto.split(/^\s*-{3,}.*$/m);
  const cabecera = bloques.shift() ?? "";

  let titulo = "";
  let gancho = "";
  let hashtags: string[] = [];

  for (const linea of cabecera.split("\n")) {
    const t = etiqueta(linea, ["TITULO"]);
    const g = etiqueta(linea, ["GANCHO"]);
    const h = etiqueta(linea, ["HASHTAGS", "ETIQUETAS"]);
    if (t !== null) titulo = t;
    if (g !== null) gancho = g;
    if (h !== null) hashtags = listaDe(h);
  }

  const escenas = bloques
    .map((bloque) => {
      const lineas = bloque.split("\n");
      const cuerpo: string[] = [];
      let keywords: string[] = [];

      for (const linea of lineas) {
        const k = etiqueta(linea, ["CLIPS", "KEYWORDS", "PALABRAS"]);
        if (k !== null) {
          keywords = listaDe(k);
          continue;
        }
        const txt = etiqueta(linea, ["TEXTO"]);
        cuerpo.push(txt !== null ? txt : linea);
      }

      return { texto: cuerpo.join(" ").replace(/\s+/g, " ").trim(), keywords };
    })
    .filter((e) => e.texto);

  if (!titulo) throw new Error("Falta la linea TITULO:");
  if (!gancho) throw new Error("Falta la linea GANCHO:");
  if (escenas.length < 3) {
    throw new Error(
      `Solo se reconocieron ${escenas.length} escenas. Separalas con una linea de guiones (---).`,
    );
  }
  const sinClips = escenas.findIndex((e) => !e.keywords.length);
  if (sinClips !== -1) {
    throw new Error(
      `La escena ${sinClips + 1} no tiene linea CLIPS: con al menos una palabra en ingles.`,
    );
  }

  // Se valida con el mismo esquema que el guion generado por la IA.
  return GuionSchema.parse({ titulo, gancho, hashtags, escenas });
}

/** Instrucciones para pegar junto al guion cuando se lleva a otra IA. */
export const INSTRUCCIONES_IA = `Reescribe el guion manteniendo EXACTAMENTE este formato:
una cabecera con TITULO:, GANCHO: y HASHTAGS:, y despues cada escena separada por
una linea de tres guiones (---), con su texto y una linea CLIPS: con una a tres
palabras en ingles para buscar el video de fondo. No anadas nada mas.`;
