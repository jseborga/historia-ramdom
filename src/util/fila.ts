/**
 * Una cosa a la vez.
 *
 * Los proveedores de voz cobran por peticion y limitan cuantas admiten por
 * minuto; ademas, dos generaciones del mismo proyecto a la vez se pisan el
 * archivo. `enFila` encadena por clave: la siguiente llamada no empieza hasta
 * que la anterior ha terminado (bien o mal).
 */

const cadenas = new Map<string, Promise<unknown>>();

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type OpcionesFila = {
  /** Milisegundos de respiro tras cada llamada, para no saturar la API. */
  separacionMs?: number;
};

export function enFila<T>(clave: string, fn: () => Promise<T>, o: OpcionesFila = {}): Promise<T> {
  const anterior = cadenas.get(clave) ?? Promise.resolve();

  // `then(fn, fn)`: la siguiente entra igual si la anterior fallo; lo que no
  // puede es entrar ANTES de que la anterior termine.
  const actual = anterior.then(
    async () => {
      try {
        return await fn();
      } finally {
        if (o.separacionMs) await esperar(o.separacionMs);
      }
    },
    async () => {
      try {
        return await fn();
      } finally {
        if (o.separacionMs) await esperar(o.separacionMs);
      }
    },
  );

  // En la cadena se guarda una promesa que nunca rechaza: un error no debe
  // arrastrar a las siguientes ni dejar rechazos sin capturar.
  const seguida = actual.then(
    () => undefined,
    () => undefined,
  );
  cadenas.set(clave, seguida);
  void seguida.then(() => {
    if (cadenas.get(clave) === seguida) cadenas.delete(clave);
  });

  return actual;
}

/** Cuantas claves tienen trabajo encolado; solo para pruebas y diagnostico. */
export const filasActivas = () => cadenas.size;
