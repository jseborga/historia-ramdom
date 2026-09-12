/**
 * Misma logica de fragmentacion que el servidor (src/render/rotulos.ts), para
 * que la vista previa muestre los mismos trozos en los mismos instantes.
 */
export type Lectura = "todo" | "frases" | "bloques";

const PALABRAS_POR_BLOQUE = 8;
const MIN_FRAGMENTO = 1.1;
const palabras = (t: string) => t.trim().split(/\s+/).filter(Boolean);

export function fragmentar(texto: string, lectura: Lectura): string[] {
  const limpio = texto.replace(/\s+/g, " ").trim();
  if (!limpio) return [];
  if (lectura === "todo") return [limpio];

  if (lectura === "frases") {
    const frases = limpio.split(/(?<=[.!?…])\s+/).filter(Boolean);
    const salida: string[] = [];
    for (const f of frases) {
      if (salida.length && palabras(f).length < 3) salida[salida.length - 1] += " " + f;
      else salida.push(f);
    }
    return salida;
  }

  const salida: string[] = [];
  let actual: string[] = [];
  for (const w of palabras(limpio)) {
    actual.push(w);
    const corte = actual.length >= PALABRAS_POR_BLOQUE || (actual.length >= 5 && /[,;:]$/.test(w));
    if (corte) {
      salida.push(actual.join(" "));
      actual = [];
    }
  }
  if (actual.length) {
    if (salida.length && actual.length <= 2) salida[salida.length - 1] += " " + actual.join(" ");
    else salida.push(actual.join(" "));
  }
  return salida;
}

export function repartirTiempo(fragmentos: string[], duracion: number): number[] {
  const pesos = fragmentos.map((f) => Math.max(palabras(f).length, 1));
  const total = pesos.reduce((a, b) => a + b, 0);
  let tiempos = pesos.map((p) => (duracion * p) / total);
  if (duracion >= fragmentos.length * MIN_FRAGMENTO) {
    const cortos = tiempos.filter((t) => t < MIN_FRAGMENTO).length;
    if (cortos) {
      const deficit = tiempos.reduce((s, t) => s + Math.max(MIN_FRAGMENTO - t, 0), 0);
      const largos = tiempos.reduce((s, t) => s + (t > MIN_FRAGMENTO ? t - MIN_FRAGMENTO : 0), 0);
      tiempos = tiempos.map((t) =>
        t < MIN_FRAGMENTO ? MIN_FRAGMENTO : t - ((t - MIN_FRAGMENTO) / largos) * deficit,
      );
    }
  }
  return tiempos;
}

/** Retardo de encendido de cada palabra dentro de un fragmento (karaoke). */
export function retardosKaraoke(fragmento: string, segundos: number): number[] {
  const ws = palabras(fragmento);
  const pesos = ws.map((w) => w.length + 1);
  const total = pesos.reduce((a, b) => a + b, 0);
  let t = 0;
  return pesos.map((p) => {
    const inicio = t;
    t += (segundos * p) / total;
    return inicio;
  });
}
