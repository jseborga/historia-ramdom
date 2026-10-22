import { DurableObject } from "cloudflare:workers";

/**
 * El estudio en Cloudflare: este Worker no hace nada del estudio en sí. Solo
 * arranca el contenedor con la app de siempre (la misma imagen que en
 * Easypanel, con R2 montado como disco), le pasa todo el tráfico y decide
 * cuándo puede dormirse.
 *
 * Un solo contenedor, siempre el mismo ("estudio"): la app guarda la cola de
 * renders y las sesiones, y dos copias se pisarían.
 *
 * Dormir sale barato y despertar tarda (medio minuto o un minuto: montar R2,
 * migrar la base, arrancar Node). Así que:
 *   - mientras alguien usa la web, sigue despierto;
 *   - mientras hay un render o algo en cola, sigue despierto aunque nadie mire
 *     (se pregunta cada 5 minutos a /api/interno/actividad);
 *   - cuando no queda nada, se deja dormir y se pone una alarma para
 *     despertarlo un poco antes del siguiente trabajo programado (una serie,
 *     una subida, las métricas), que la app sabe y el Worker no.
 */

interface Env {
  ESTUDIO: DurableObjectNamespace<Estudio>;
  /** Tamaño del contenedor: standard-2 (1 vCPU, 6 GiB) por defecto. */
  INSTANCIA?: string;
  API_TOKEN?: string;
  [clave: string]: unknown;
}

const PUERTO = 3000;
/** Sin peticiones ni trabajo, cuánto tarda en dormirse. */
const DORMIR_TRAS_MS = 15 * 60_000;
/** Cada cuánto se pregunta a la app si sigue ocupada. */
const REVISAR_CADA_MS = 5 * 60_000;
/** Cuánto antes de un trabajo programado se despierta (arrancar tarda). */
const DESPERTAR_ANTES_MS = 3 * 60_000;
/** Lo máximo que se espera a que la app conteste tras arrancar. */
const ARRANQUE_MAX_MS = 3 * 60_000;

/** Sin esto la app no arranca: se avisa antes de intentarlo. */
const OBLIGATORIAS = [
  "PUBLIC_URL",
  "DATABASE_URL",
  "REDIS_URL",
  "ENCRYPTION_KEY",
  "API_TOKEN",
  "R2_BUCKET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
];

/** Lo que solo usa el Worker y no tiene por qué ver la app. */
const SOLO_WORKER = new Set(["INSTANCIA"]);

/**
 * Las variables del contenedor: todas las de texto del Worker (las `vars` de
 * wrangler.jsonc y los secretos), que son las mismas del .env de Easypanel.
 */
function variablesDelContenedor(env: Env): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(env)) {
    if (typeof valor === "string" && !SOLO_WORKER.has(clave)) salida[clave] = valor;
  }
  return {
    NODE_ENV: "production",
    ...salida,
    PORT: String(PUERTO),
    DATA_DIR: "/data",
    TRABAJO_DIR: "/tmp/trabajo",
  };
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Estudio extends DurableObject<Env> {
  private arrancando: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Tras un despliegue el objeto vuelve a empezar sin el temporizador.
    const contenedor = ctx.container;
    if (contenedor?.running) {
      void ctx.blockConcurrencyWhile(() => contenedor.setInactivityTimeout(DORMIR_TRAS_MS));
    }
  }

  async fetch(peticion: Request): Promise<Response> {
    const faltan = OBLIGATORIAS.filter((k) => typeof this.env[k] !== "string" || !this.env[k]);
    if (faltan.length) {
      return new Response(`Faltan variables en el Worker: ${faltan.join(", ")}. Mira cloudflare/README.md.`, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    try {
      // Peticiones a la vez comparten el mismo arranque.
      this.arrancando ??= this.arrancar().finally(() => {
        this.arrancando = undefined;
      });
      await this.arrancando;
    } catch (err) {
      return new Response(`El estudio no arrancó: ${err instanceof Error ? err.message : String(err)}`, {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "30" },
      });
    }

    const original = new URL(peticion.url);
    const url = new URL(peticion.url);
    url.protocol = "http:";
    url.host = "container";
    const reenviada = new Request(url, peticion);
    reenviada.headers.delete("host");
    // La app confía en el proxy (trustProxy): así ve el HTTPS, el dominio y la
    // IP real de quien entra, como detrás de Easypanel.
    reenviada.headers.set("x-forwarded-proto", "https");
    reenviada.headers.set("x-forwarded-host", original.host);
    const ip = peticion.headers.get("cf-connecting-ip");
    if (ip) reenviada.headers.set("x-forwarded-for", ip);
    return this.ctx.container!.getTcpPort(PUERTO).fetch(reenviada);
  }

  /** Arranca el contenedor si está dormido y espera a que la app conteste. */
  private async arrancar(): Promise<void> {
    const contenedor = this.ctx.container;
    if (!contenedor) throw new Error("Este Worker no tiene contenedor configurado");
    if (!contenedor.running) {
      contenedor.start({
        image: contenedor.images.base,
        instance: (this.env.INSTANCIA ?? "standard-2") as "standard-2",
        // Hace falta Internet: R2, la base de datos, Redis, la IA y los bancos de vídeo.
        enableInternet: true,
        entrypoint: ["/usr/bin/tini", "--", "/app/cloudflare/arranque.sh"],
        env: variablesDelContenedor(this.env),
      });
      this.ctx.waitUntil(
        contenedor
          .monitor()
          .then(() => console.log("El estudio se durmió"))
          .catch((err) => console.error("El estudio se paró con error", err)),
      );
    }
    await contenedor.setInactivityTimeout(DORMIR_TRAS_MS);
    await this.esperarApp();
    await this.ctx.storage.setAlarm(Date.now() + REVISAR_CADA_MS);
  }

  private async esperarApp(): Promise<void> {
    const puerto = this.ctx.container!.getTcpPort(PUERTO);
    const limite = Date.now() + ARRANQUE_MAX_MS;
    let ultimo = "";
    while (Date.now() < limite) {
      try {
        const r = await puerto.fetch("http://container/api/salud", { signal: AbortSignal.timeout(3000) });
        await r.body?.cancel();
        if (r.ok) return;
        ultimo = `la app responde ${r.status}`;
      } catch (err) {
        ultimo = err instanceof Error ? err.message : String(err);
      }
      if (!this.ctx.container!.running) throw new Error("el contenedor se detuvo al arrancar (mira los registros)");
      await espera(1500);
    }
    throw new Error(`la app no contestó en ${ARRANQUE_MAX_MS / 1000} s (${ultimo})`);
  }

  /** Lo que la app tiene entre manos, o null si no se pudo preguntar. */
  private async actividad(): Promise<{ ocupado: boolean; proximo: string | null } | null> {
    try {
      const r = await this.ctx.container!.getTcpPort(PUERTO).fetch("http://container/api/interno/actividad", {
        headers: { Authorization: `Bearer ${this.env.API_TOKEN ?? ""}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!r.ok) {
        await r.body?.cancel();
        return null;
      }
      return (await r.json()) as { ocupado: boolean; proximo: string | null };
    } catch {
      return null;
    }
  }

  /**
   * La revisión periódica. Despierto: si hay trabajo, o algo programado en
   * breve, se sigue revisando (y eso lo mantiene despierto); si no, se deja
   * dormir y se apunta cuándo despertarlo. Dormido: es la hora de un trabajo
   * programado, así que se arranca.
   */
  async alarm(): Promise<void> {
    const contenedor = this.ctx.container;
    if (!contenedor) return;
    if (!contenedor.running) {
      this.arrancando ??= this.arrancar().finally(() => {
        this.arrancando = undefined;
      });
      await this.arrancando;
      return;
    }
    const a = await this.actividad();
    const proximo = a?.proximo ? Date.parse(a.proximo) : NaN;
    const pronto = Number.isFinite(proximo) && proximo - Date.now() < DORMIR_TRAS_MS + REVISAR_CADA_MS;
    if (!a || a.ocupado || pronto) {
      await this.ctx.storage.setAlarm(Date.now() + REVISAR_CADA_MS);
      return;
    }
    // Nada que hacer pronto: se dormirá solo por inactividad.
    if (Number.isFinite(proximo)) await this.ctx.storage.setAlarm(proximo - DESPERTAR_ANTES_MS);
  }

  /** Red de seguridad del cron: que nunca se quede sin alarma. */
  async revisar(): Promise<void> {
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 1000);
  }
}

export default {
  fetch(peticion: Request, env: Env): Promise<Response> {
    return env.ESTUDIO.getByName("estudio").fetch(peticion);
  },
  async scheduled(_controlador: ScheduledController, env: Env): Promise<void> {
    await env.ESTUDIO.getByName("estudio").revisar();
  },
} satisfies ExportedHandler<Env>;
