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

/** `datetime-local` da hora local sin zona; la API espera ISO con offset. */
export function aISO(valorLocal: string): string | null {
  if (!valorLocal) return null;
  const fecha = new Date(valorLocal);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}

export const api = {
  get: <T>(ruta: string) => peticion<T>(ruta),
  /** Subida de archivos: sin Content-Type, lo pone el navegador con el limite. */
  subir: async <T>(ruta: string, archivo: File): Promise<T> => {
    const cuerpo = new FormData();
    cuerpo.append("archivo", archivo);
    const res = await fetch(ruta, { method: "POST", body: cuerpo, credentials: "same-origin" });
    const datos = await res.json().catch(() => null);
    if (!res.ok) throw new ErrorAPI(datos?.error ?? `Error ${res.status}`, res.status);
    return datos as T;
  },
  put: <T>(ruta: string, cuerpo: unknown) =>
    peticion<T>(ruta, { method: "PUT", body: JSON.stringify(cuerpo) }),
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
  vozOpenAIPorDefecto: Voz;
  musica: string[];
  clips: { pexels: boolean; pixabay: boolean };
  tiktok: { configurado: boolean; cuentasConectadas: number; permisos: string[] };
  reddit: { configurado: boolean };
  idiomas: Idioma[];
  limites: { clipMB: number; videoMB: number };
  retencionDias: number;
};

export type Idioma = "es" | "en";

export type ModoAudio = "VOZ" | "MUSICA" | "MUDO";

export type Preset = {
  id: string;
  nombre: string;
  ancho: number;
  alto: number;
  fps: number;
  maxSegundos: number;
  nota: string;
};

export type Posicion = "arriba" | "centro" | "abajo";
export type Animacion = "ninguna" | "fundido" | "subir" | "zoom";

export type EstiloTexto = {
  tamano: number;
  color: string;
  contorno: string;
  posicion: Posicion;
  negrita: boolean;
};

export type EscenaMontaje = {
  id: string;
  clip: ClipCandidato | null;
  color: string;
  duracion: number;
  texto: string;
  estilo: EstiloTexto;
  animacion: Animacion;
  esGancho: boolean;
};

export type VozCapa = {
  modo: "ninguna" | "ia" | "archivo";
  archivo: string | null;
  config: Voz | null;
};

export type MusicaCapa = {
  archivo: string | null;
  subida: boolean;
  volumen: number;
};

export type Proyecto = {
  id: string;
  historiaId: string | null;
  nombre: string;
  formato: string;
  escenas: EscenaMontaje[];
  voz: VozCapa | null;
  musica: MusicaCapa | null;
  archivo: string | null;
  duracionSeg: number | null;
  estado: "BORRADOR" | "RENDER" | "LISTO" | "ERROR";
  error: string | null;
  editadoEn: string;
  musicaDisponible?: string[];
};

export type ClipCandidato = {
  id: string;
  fuente: "pexels" | "pixabay";
  autor: string;
  pagina: string;
  licencia: string;
  url: string;
  imagen?: string;
};

export type Prueba = {
  id: string;
  nombre: string;
  grupo: "Infraestructura" | "Guion" | "Voz" | "Clips" | "Publicacion";
  estado: "ok" | "error" | "sin_configurar";
  detalle: string;
  ms: number;
};

export type Guion = {
  titulo: string;
  gancho: string;
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
  idioma: Idioma;
  cron: string;
  zonaHoraria: string;
  motor: string;
  modelo: string | null;
  voz: Voz;
  musica: string | null;
  musicaModo: "FIJA" | "ROTAR";
  modoAudio: ModoAudio;
  segundosEscena: number | null;
  modoPublicacion: ModoPublicacion;
  activa: boolean;
  _count?: { historias: number };
};

export type Metrica = {
  vistas: number;
  likes: number;
  comentarios?: number;
  compartidos?: number;
  guardados?: number;
  duracionSeg?: number | null;
  tiempoPromedioSeg: number | null;
  puntuacion: number | null;
};

export type Idea = {
  id: string;
  titulo: string;
  tema: string;
  idioma: Idioma;
  fuente: "MANUAL" | "IA" | "REDDIT";
  refExterna: string | null;
  notas: string | null;
  estado: "PENDIENTE" | "USADA" | "DESCARTADA";
  puntuacion: number | null;
  usos: number;
};

export type Gancho = {
  id: string;
  texto: string;
  idioma: Idioma;
  usos: number;
  puntuacion: number | null;
};

export type Rendimiento = {
  mejoresGanchos: Gancho[];
  mejoresIdeas: Idea[];
  historias: (Metrica & {
    historiaId: string;
    historia: { id: string; titulo: string | null; ganchoTexto: string | null };
  })[];
};

export type Historia = {
  id: string;
  serieId: string | null;
  estado: "GUION" | "CLIPS" | "VOZ" | "RENDER" | "LISTA" | "SUBIDA" | "ERROR";
  titulo: string | null;
  ganchoTexto: string | null;
  metrica: Metrica | null;
  descripcion: string | null;
  archivo: string | null;
  publishId: string | null;
  publicarEn: string | null;
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
