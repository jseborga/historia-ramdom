/**
 * Las etiquetas entre corchetes de Suno, que no son letra.
 *
 * En el campo de letra de Suno, `[Chorus]` o `[Guitar Solo]` son
 * **instrucciones**: marcan la estructura y no se cantan. Pero solo funcionan
 * si Suno las reconoce. Una acotación escrita a mano —`[la guitarra entra con
 * rabia]`, `[se escucha una puerta]`— no es una etiqueta: Suno la trata como
 * una línea más y acaba **cantada** dentro del tema. Es el fallo más común al
 * pedirle música a un modelo de texto, porque escribir acotaciones es lo
 * natural en un guion.
 *
 * Aquí se separan las dos cosas:
 *
 *  - lo que es una etiqueta de verdad se deja (y se escribe como Suno la
 *    espera: en inglés y con su nombre canónico);
 *  - lo que es una acotación se **saca de la letra** y se devuelve aparte,
 *    para que vaya donde tiene que ir: las notas de arreglo, que lee una
 *    persona, o la caja de estilo.
 */

/** Etiquetas que Suno entiende, con su nombre canónico. */
const CANONICAS = [
  // Estructura
  "Intro", "Verse", "Pre-Chorus", "Chorus", "Post-Chorus", "Bridge", "Hook", "Refrain",
  "Break", "Breakdown", "Drop", "Build", "Interlude", "Outro", "End", "Fade Out",
  "Instrumental", "Instrumental Break", "Silence",
  // Interpretación
  "Solo", "Guitar Solo", "Sax Solo", "Piano Solo", "Bass Solo", "Drum Solo", "Drum Fill",
  "Percussion Break", "Key Change", "Tempo Up", "Half-Time", "Double-Time", "Big Finish",
  "Crescendo", "Riff", "Main Riff",
  // Voz
  "Spoken Word", "Whispered", "Shouted", "Female Vocal", "Male Vocal", "Duet", "Choir",
  "Harmony", "Backing Vocals", "Ad Libs", "Vocal Chops",
] as const;

const clave = (v: string) =>
  v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const PORCLAVE = new Map(CANONICAS.map((c) => [clave(c), c]));

/**
 * Lo que la gente (y los modelos) escriben en español, y su etiqueta real.
 * Traducirlas es mejor que tirarlas: la intención era buena.
 */
const TRADUCCIONES: Record<string, string> = {
  "introduccion": "Intro",
  "entrada": "Intro",
  "verso": "Verse",
  "estrofa": "Verse",
  "pre estribillo": "Pre-Chorus",
  "preestribillo": "Pre-Chorus",
  "coro": "Chorus",
  "estribillo": "Chorus",
  "estribillo final": "Chorus",
  "post coro": "Post-Chorus",
  "puente": "Bridge",
  "gancho": "Hook",
  "corte": "Break",
  "quiebre": "Breakdown",
  "bajon": "Drop",
  "caida": "Drop",
  "subida": "Build",
  "interludio": "Interlude",
  "final": "Outro",
  "cierre": "Outro",
  "salida": "Outro",
  "desvanecer": "Fade Out",
  "silencio": "Silence",
  "solo": "Solo",
  "solo de guitarra": "Guitar Solo",
  "solo de saxo": "Sax Solo",
  "solo de saxofon": "Sax Solo",
  "solo de piano": "Piano Solo",
  "solo de bajo": "Bass Solo",
  "solo de bateria": "Drum Solo",
  "redoble": "Drum Fill",
  "relleno de bateria": "Drum Fill",
  "percusion": "Percussion Break",
  "cambio de tono": "Key Change",
  "mas rapido": "Tempo Up",
  "hablado": "Spoken Word",
  "susurrado": "Whispered",
  "susurro": "Whispered",
  "gritado": "Shouted",
  "voz femenina": "Female Vocal",
  "voz masculina": "Male Vocal",
  "duo": "Duet",
  "coros": "Backing Vocals",
  "armonias": "Harmony",
  "riff principal": "Main Riff",
  "riff": "Riff",
  "instrumental": "Instrumental",
  "parte instrumental": "Instrumental Break",
};

/**
 * Palabras que, en una etiqueta corta y en inglés, la hacen creíble aunque no
 * esté en la lista: `[Trumpet Solo]`, `[808 Drop]`, `[Blast Beats]`.
 */
const PALABRAS_OK =
  /\b(intro|verse|chorus|bridge|hook|break|drop|build|outro|solo|riff|fill|beat|beats|drums|drum|bass|guitar|piano|synth|keys|brass|horns|strings|choir|vocal|vocals|harmony|percussion|groove|melody|theme|coda|refrain|instrumental|ambient|pad|arp|breakdown|tempo|key)\b/;

export type RevisionEtiquetas = {
  /** La letra ya limpia: etiquetas de verdad, y nada más entre corchetes. */
  texto: string;
  /** Acotaciones sacadas de la letra: no eran etiquetas, se habrían cantado. */
  sacadas: string[];
  /** Etiquetas que sí lo eran pero estaban mal escritas: `[coro]` → `[Chorus]`. */
  cambiadas: { de: string; a: string }[];
};

/** Una etiqueta suelta: su forma canónica, o null si no es una etiqueta. */
export function etiquetaCanonica(dentro: string): string | null {
  const k = clave(dentro);
  if (!k) return null;
  const directa = PORCLAVE.get(k) ?? TRADUCCIONES[k];
  if (directa) return directa;

  // "Verse 2", "Chorus 3": el número es parte de la estructura y se conserva.
  const conNumero = /^(.*?)\s*(\d{1,2})$/.exec(k);
  if (conNumero) {
    const base = PORCLAVE.get(conNumero[1]) ?? TRADUCCIONES[conNumero[1]];
    if (base) return `${base} ${conNumero[2]}`;
  }

  // Etiqueta corta, en inglés y con una palabra de música dentro: vale tal
  // cual. Así no se tira `[Trumpet Solo]` por no estar en una lista.
  const palabras = k.split(" ");
  if (palabras.length <= 4 && PALABRAS_OK.test(k) && /^[a-z0-9 ]+$/.test(k)) {
    return dentro.trim().replace(/\s+/g, " ");
  }
  return null;
}

/**
 * Revisa la letra entera. Devuelve el texto con las etiquetas bien escritas y,
 * aparte, lo que había entre corchetes sin serlo.
 */
export function revisarEtiquetas(texto: string): RevisionEtiquetas {
  const sacadas: string[] = [];
  const cambiadas: { de: string; a: string }[] = [];

  const lineas = texto.split(/\r?\n/).map((linea) => {
    const limpia = linea.trim();
    // Línea que es SOLO una etiqueta: es la posición normal.
    const sola = /^\[([^\]]{1,120})\]$/.exec(limpia);
    if (sola) {
      const canonica = etiquetaCanonica(sola[1]);
      if (!canonica) {
        sacadas.push(sola[1].trim());
        return null; // fuera de la letra
      }
      if (canonica !== sola[1].trim()) cambiadas.push({ de: sola[1].trim(), a: canonica });
      return `[${canonica}]`;
    }

    // Corchetes en medio de un verso: eso Suno lo canta casi siempre.
    if (/\[[^\]]+\]/.test(limpia)) {
      const suelta = limpia.replace(/\[([^\]]{1,120})\]/g, (_todo, dentro: string) => {
        const canonica = etiquetaCanonica(dentro);
        if (canonica) {
          if (canonica !== dentro.trim()) cambiadas.push({ de: dentro.trim(), a: canonica });
          return `[${canonica}]`;
        }
        sacadas.push(dentro.trim());
        return "";
      });
      // Quitar la acotación deja espacios sueltos donde estaba.
      const arreglada = suelta.replace(/\s{2,}/g, " ").trim();
      return arreglada || null;
    }
    return linea;
  });

  const texto2 = lineas
    .filter((l): l is string => l !== null)
    .join("\n")
    .replace(/[ \t]+$/gm, "")
    // Dos líneas en blanco seguidas quedan feas al quitar una etiqueta.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { texto: texto2, sacadas: [...new Set(sacadas)].slice(0, 20), cambiadas: cambiadas.slice(0, 20) };
}

/** Las etiquetas que hay en un texto, en orden. Sirve para enseñar la estructura. */
export const etiquetasDe = (texto: string): string[] =>
  [...texto.matchAll(/^\[([^\]]{1,120})\]$/gm)].map((m) => m[1].trim());

/** La lista para el prompt: así el modelo no se inventa etiquetas. */
export const VOCABULARIO = CANONICAS.join(", ");
