export class ErrorAPI extends Error {
  constructor(
    mensaje: string,
    readonly estado: number,
  ) {
    super(mensaje);
  }
}

async function peticion<T>(ruta: string, init?: RequestInit): Promise<T> {
  const res = await fetch(ruta, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    credentials: "same-origin",
  });
  const datos = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle = Array.isArray(datos?.detalle) ? ` (${datos.detalle.join("; ")})` : "";
    throw new ErrorAPI((datos?.error ?? `Error ${res.status}`) + detalle, res.status);
  }
  return datos as T;
}

export const api = {
  get: <T>(ruta: string) => peticion<T>(ruta),
  post: <T>(ruta: string, cuerpo?: unknown) =>
    peticion<T>(ruta, { method: "POST", body: cuerpo ? JSON.stringify(cuerpo) : undefined }),
  patch: <T>(ruta: string, cuerpo: unknown) =>
    peticion<T>(ruta, { method: "PATCH", body: JSON.stringify(cuerpo) }),
  borrar: <T>(ruta: string) => peticion<T>(ruta, { method: "DELETE" }),
};

export type Voz = { proveedor: "gemini" | "openai"; modelo: string; nombre: string };

export type Catalogo = {
  motores: { id: string; modelo: string; disponible: boolean }[];
  voces: Record<"gemini" | "openai", string[]>;
  vozPorDefecto: Voz;
  musica: string[];
  clips: { pexels: boolean; pixabay: boolean };
  tiktok: { configurado: boolean; cuentasConectadas: number };
  retencionDias: number;
};

export type Guion = {
  titulo: string;
  escenas: { texto: string; keywords: string[] }[];
  hashtags: string[];
};

export type ModoPublicacion = "DESCARGA" | "BORRADOR_TIKTOK" | "DIRECTO_TIKTOK";

export type Serie = {
  id: string;
  nombre: string;
  tipo: "Reflexion" | "Historia";
  temas: string[];
  duracion: number;
  cron: string;
  zonaHoraria: string;
  motor: string;
  voz: Voz;
  musica: string | null;
  modoPublicacion: ModoPublicacion;
  activa: boolean;
  _count?: { historias: number };
};

export type Historia = {
  id: string;
  serieId: string | null;
  estado: "GUION" | "CLIPS" | "VOZ" | "RENDER" | "LISTA" | "SUBIDA" | "ERROR";
  titulo: string | null;
  descripcion: string | null;
  archivo: string | null;
  publishId: string | null;
  error: string | null;
  creadaEn: string;
};

export type CuentaTikTok = {
  id: string;
  openId: string;
  nombre: string | null;
  scopes: string;
  expiraEn: string;
};
