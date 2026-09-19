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

export type Voz = { proveedor: "local" | "gemini" | "openai"; modelo: string; nombre: string };

export type Fuente = { id: string; nombre: string; estilo: "sans" | "serif" };

export type Catalogo = {
  motores: { id: string; modelo: string; disponible: boolean }[];
  voces: Record<"local" | "gemini" | "openai", string[]>;
  vocesLocales: VozLocal[];
  vozPorDefecto: Voz;
  vozGeminiPorDefecto: Voz;
  vozOpenAIPorDefecto: Voz;
  /** Que proveedores de voz tienen clave; sin ella la sintesis falla despues. */
  vozDisponible?: { local: boolean; gemini: boolean; openai: boolean };
  musica: string[];
  clips: {
    pexels: boolean;
    pixabay: boolean;
    nasa?: boolean;
    openverse?: boolean;
    wikimedia?: boolean;
    archive?: boolean;
  };
  /** Bancos de imagen disponibles y qué medios admiten. */
  bancos?: { id: string; nombre: string; nota: string; listo: boolean }[];
  medios?: { id: string; nombre: string }[];
  tiktok: { configurado: boolean; cuentasConectadas: number; permisos: string[] };
  reddit: { configurado: boolean };
  idiomas: Idioma[];
  /** Como se llama cada idioma en pantalla; lo manda el servidor. */
  nombresIdioma?: Record<string, string>;
  regiones: { id: Region; nombre: string }[];
  generosIA: Record<string, Genero>;
  calidades: { id: Calidad; nombre: string; nota: string; escala: number; fps: number | null }[];
  categorias: Categoria[];
  categoriaAleatoria: string;
  areas?: Area[];
  limites: { clipMB: number; videoMB: number; videoclipSeg: number };
  retencionDias: number;
};

/**
 * "spanglish" no es un idioma de diccionario, pero es como se canta media
 * America: base en espanol con ingles dentro, sobre todo en el gancho.
 */
export type Idioma = "es" | "en" | "spanglish";

/** Perfil de compresion del render. */
export type Calidad = "alta" | "normal" | "ligera";

/** Lo que pesaria el video con una calidad concreta. */
export type Estimacion = {
  calidad: Calidad;
  nombre: string;
  nota: string;
  ancho: number;
  alto: number;
  fps: number;
  bitrate: number;
  bytes: number;
  mb: number;
  cabe: boolean;
  /** true = calculado con lo que pesaron renders anteriores, no con la tabla. */
  medido: boolean;
};

export type ResumenEstimacion = {
  segundos: number;
  duracion: number;
  formato: string;
  limiteMB: number;
  calidad: Calidad;
  opciones: Estimacion[];
  aviso: string | null;
  bytesReales?: number | null;
};

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
export type Animacion = "ninguna" | "fundido" | "subir" | "zoom" | "resaltar" | "apareciendo";
export type Efecto =
  | "ninguno"
  | "zoomLento"
  | "alejar"
  | "paneoDerecha"
  | "paneoIzquierda"
  | "kenBurns"
  | "fundido"
  | "blancoYNegro"
  | "vineta";

export type EstiloTexto = {
  fuente: string;
  tamano: number;
  color: string;
  contorno: string;
  posicion: Posicion;
  negrita: boolean;
};

export type Lectura = "todo" | "frases" | "bloques";

/** Un clip de la pista de video; su inicio es la suma de los anteriores. */
export type Transicion = "ninguna" | "fundido" | "desplazar" | "barrido" | "circulo";

export type ClipPista = {
  id: string;
  clip: ClipCandidato | null;
  color: string;
  duracion: number;
  recorte: number;
  efecto: Efecto;
  /** "recortar" llena el lienzo; "ajustar" cabe entera con fondo desenfocado. */
  encuadre?: "recortar" | "ajustar";
  /** Cómo se pasa al clip siguiente. */
  transicion?: Transicion;
  transicionSeg?: number;
};

/** Un rotulo de la pista de textos, con su propio sitio en el tiempo. */
export type RotuloPista = {
  id: string;
  inicio: number;
  duracion: number;
  texto: string;
  estilo: EstiloTexto;
  animacion: Animacion;
  lectura: Lectura;
};

/** La narracion: un solo texto, una sola voz, colocada en `inicio`. */
export type VozPista = {
  modo: "ninguna" | "servidor" | "archivo";
  texto: string;
  config: Voz | null;
  archivo: string | null;
  duracion: number | null;
  inicio: number;
  huella: string | null;
  /** Frase a frase, con el tiempo real que ocupa cada una en el audio. */
  tramos: { texto: string; inicio: number; duracion: number }[];
};

/** Un tramo de la cancion: intro, verso, coro... con lo que debe verse en el. */
export type Seccion = {
  etiqueta: string;
  texto: string;
  peso: number;
  destacada: boolean;
  keywords: string[];
  /** Descripcion larga en ingles para generar la imagen de ese tramo. */
  prompt: string;
};

/** Una cancion dentro de la pista de musica de un videoclip. */
export type ParteMusica = {
  archivo: string;
  titulo: string;
  enlace: string | null;
  inicio: number;
  duracion: number;
  letra: string;
};

/** Lo que propone la IA para describir el videoclip. */
export type Sugerencia = {
  lineamientos: string;
  estiloVisual: string;
  keywords: string[];
  prompt: string;
  hashtags: string[];
};

/** El analisis de la letra (o de los lineamientos) de un videoclip. */
export type Letra = {
  instrumental: boolean;
  titulo: string;
  texto: string;
  lineamientos: string;
  /** En que idioma esta la letra: manda en el analisis y en los rotulos. */
  idioma: Idioma;
  estiloVisual: string;
  mostrarLetra: boolean;
  secciones: Seccion[];
  keywords: string[];
  hashtags: string[];
};

/** Un corte o formato alternativo del mismo montaje. */
export type Variante = {
  id: string;
  proyectoId: string;
  nombre: string;
  formato: string;
  inicio: number;
  duracion: number | null;
  archivo: string | null;
  duracionSeg: number | null;
  /** Vacia = la calidad del proyecto. */
  calidad: Calidad | null;
  bytes: number | null;
  estado: "BORRADOR" | "MONTAJE" | "RENDER" | "LISTO" | "ERROR";
  error: string | null;
  creadaEn: string;
};

/** Tramo sugerido para cortar, sacado del nivel de la musica y del coro. */
export type Momento = {
  inicio: number;
  duracion: number;
  puntuacion: number;
  motivo: string;
};

export type MusicaCapa = {
  archivo: string | null;
  subida: boolean;
  volumen: number;
  /** Las canciones encadenadas que forman la pista; vacio = una sola. */
  partes: ParteMusica[];
};

export type Proyecto = {
  id: string;
  historiaId: string | null;
  nombre: string;
  /** NARRACION: historia con voz. MUSICA: videoclip gobernado por la cancion. */
  tipo: "NARRACION" | "MUSICA";
  formato: string;
  /** Perfil de compresion: alta, normal o ligera. */
  calidad: Calidad;
  /** Lo que peso el MP4, cuando ya se renderizo. */
  bytes?: number | null;
  video: ClipPista[];
  textos: RotuloPista[];
  voz: VozPista;
  musica: MusicaCapa | null;
  archivo: string | null;
  descripcion: string | null;
  duracionSeg: number | null;
  estado: "BORRADOR" | "MONTAJE" | "RENDER" | "LISTO" | "ERROR";
  error: string | null;
  editadoEn: string;
  letra?: Letra | null;
  variantes?: Variante[];
  musicaDisponible?: string[];
  fuentes?: Fuente[];
};

/** Un vídeo o una foto de la biblioteca. */
export type Medio = {
  id: string;
  clase: "VIDEO" | "IMAGEN";
  archivo: string;
  nombre: string;
  fuente: string;
  autor: string | null;
  pagina: string | null;
  licencia: string | null;
  duracion: number | null;
  ancho: number | null;
  alto: number | null;
  bytes: number | null;
  etiquetas: string[];
  creadoEn: string;
  /** El mismo medio ya convertido en clip para la línea de tiempo. */
  clip: ClipCandidato;
};

/** Un diálogo escrito: quiénes hablan y qué dice cada uno. */
/** Una voz repartida por la app, con el porque. */
export type VozRepartida = { indice: number; config: Voz; motivo: string };

export type GuionDialogo = {
  titulo: string;
  tema: string;
  /** `voz` es como deberia sonar, en una palabra: la propone quien escribe. */
  hablantes: { nombre: string; papel: string; voz?: string }[];
  intervenciones: { hablante: number; texto: string }[];
  keywords: string[];
  hashtags: string[];
  ganchos: string[];
  motorUsado?: string;
  avisoMotor?: string;
};

/** Un ritmo al que se puede llevar una cancion. */
export type Ritmo = { id: string; nombre: string; familia: string; estilo: string; bpm: string };

/** Una version del remix: la cancion en un ritmo, con las cajas de Suno. */
export type VersionRemix = {
  ritmo: string;
  titulo: string;
  /** Caja "Style of Music" de Suno. */
  estilo: string;
  /** Caja "Exclude styles". */
  excluir: string;
  bpm: string;
  tonalidad: string;
  /** Letra con las etiquetas de seccion ([Verse], [Chorus]...). */
  letra: string;
  indicaciones: string;
  /** El trozo que va en los 15 segundos del corto. */
  gancho: string;
  porQue: string;
};

/** Una mezcla que funciona, con el porque. */
export type Fusion = { ids: [string, string]; nombre: string; nota: string };

/** Para que es la pista: cambia la estructura, no solo el estilo. */
export type UsoPista = { id: string; nombre: string; pista: string };

export type SeccionInstrumental = {
  /** Etiqueta de Suno, sin corchetes. */
  etiqueta: string;
  segundos?: number;
  /** Que pasa ahi. Es nota para quien lo monta: NO se pega en Suno. */
  que: string;
};

export type Instrumental = {
  titulo: string;
  estilo: string;
  excluir: string;
  bpm: string;
  tonalidad: string;
  /** Que pone cada genero en la mezcla. */
  aportes: string[];
  estructura: SeccionInstrumental[];
  indicaciones: string;
  porQue: string;
  letra: string;
  /** Lo que se pega EN LA CAJA DE LETRA de Suno. */
  cajaLetra: string;
  /** Corchetes que no eran etiquetas: Suno los habria cantado. */
  avisos: string[];
  corregidas: { de: string; a: string }[];
  conVoz: boolean;
  motorUsado?: string;
  avisoMotor?: string;
};

export type Remix = {
  esencia: string;
  versiones: VersionRemix[];
  ganchos: string[];
  hashtags: string[];
  motorUsado?: string;
  avisoMotor?: string;
  /** Frases del original coladas tal cual; solo con letra ajena. */
  calcos: string[];
  /** Corchetes que no eran etiquetas de Suno y se quitaron de la letra. */
  avisos: string[];
};

/** Un producto de Amazon: lo que se ensena y con que enlace se publica. */
export type Producto = {
  asin: string;
  mercado: string;
  titulo: string;
  marca: string;
  /** Precio del dia, tal y como lo da Amazon. Nunca se narra. */
  precio: string;
  /** Foto principal; vacia si no hay API de Afiliados. */
  imagen: string;
  imagenes: string[];
  caracteristicas: string[];
  /** Enlace con la etiqueta de afiliado, ya montado por el servidor. */
  enlace: string;
};

/** Que se puede hacer con Amazon ahora mismo, segun lo que este configurado. */
export type EstadoAmazon = {
  /** Con API: buscar productos y usar sus fotos. */
  api: boolean;
  /** Con etiqueta: los enlaces generan comision. */
  etiqueta: boolean;
  mercado: string;
  mercados: { id: string; nombre: string; dominio: string }[];
  divulgacion: string;
  ordenes: string[];
  nota: string;
};

/** Guion de un video con producto: el objeto es la excusa, el giro es el final. */
export type GuionProducto = {
  titulo: string;
  gancho: string;
  usos: string[];
  reflexion: string;
  advertencia: string;
  cierre: string;
  keywords: string[];
  hashtags: string[];
  ganchos: string[];
  motorUsado?: string;
  avisoMotor?: string;
};

/**
 * Miniatura servida por la app. Enlazar directamente al CDN del banco se cae
 * por muchos sitios (politicas del navegador, redes que bloquean terceros,
 * CDN sin enlazado externo); lo propio se sirve tal cual.
 */
export const urlMuestra = (u?: string | null) =>
  !u ? "" : u.startsWith("/") ? u : `/api/muestra?url=${encodeURIComponent(u)}`;

/** Lo que devuelve la busqueda de clips: resultados y como le fue a cada banco. */
export type Busqueda = {
  clips: ClipCandidato[];
  bancos: { banco: string; encontrados: number; error?: string }[];
};

export type ClipCandidato = {
  id: string;
  fuente: "pexels" | "pixabay" | "nasa" | "openverse" | "wikimedia" | "archive" | "subido";
  /** "imagen" = foto: en el render se anima para que parezca vídeo. */
  tipo?: "video" | "imagen";
  autor: string;
  pagina: string;
  licencia: string;
  url: string;
  imagen?: string;
  /** Duracion real del archivo en origen, en segundos. */
  duracion?: number;
  /** Nombre en la biblioteca: si está, sale del disco y no de un banco. */
  archivo?: string;
};

export type Genero = "masculino" | "femenino" | "desconocido";

export type VozLocal = {
  id: string;
  nombre: string;
  motor: "espeak" | "mbrola" | "piper";
  idioma: "es" | "en";
  calidad: 1 | 2 | 3;
  genero: Genero;
};

export type Region = "bolivia" | "latam" | "eeuu";

export type Prueba = {
  id: string;
  nombre: string;
  grupo: "Infraestructura" | "Guion" | "Voz" | "Clips" | "Publicacion";
  estado: "ok" | "error" | "sin_configurar";
  detalle: string;
  ms: number;
};

export type Categoria = {
  id: string;
  nombre: string;
  /** "ficcion" (historias) o "ideas" (libros, filosofía, poder, dinero...). */
  area: string;
  tono: string;
  subcategorias: { id: string; nombre: string; pista: string }[];
};

/** Las dos áreas de historia, con el valor que sortea dentro de cada una. */
export type Area = { id: string; nombre: string; nota: string; aleatoria: string };

/** Planteamiento previo: título y lineamientos antes de escribir la historia. */
export type Premisa = {
  categoria: string;
  subcategoria: string;
  titulo: string;
  lineamientos: string[];
  personajes: string[];
  giro: string;
  /** Área de ideas: de dónde sale (obra, autor, corriente) y cuál es. */
  fuente?: string;
  idea?: string;
  keywords: string[];
  hashtags: string[];
  categoriaNombre?: string;
  subcategoriaNombre?: string;
  /** Quién lo escribió de verdad y, si no fue el pedido, por qué. */
  motorUsado?: string;
  avisoMotor?: string;
};

/** Un capítulo de miniserie dentro del plan. */
export type Capitulo = {
  numero: number;
  titulo: string;
  resumen: string;
  cliffhanger: string;
};

/** Miniserie planeada de golpe: la historia larga repartida en capítulos. */
export type Miniserie = {
  categoria: string;
  subcategoria: string;
  titulo: string;
  sinopsis: string;
  personajes: string[];
  capitulos: Capitulo[];
  keywords: string[];
  hashtags: string[];
  categoriaNombre?: string;
  subcategoriaNombre?: string;
  motorUsado?: string;
  avisoMotor?: string;
};

export type Guion = {
  titulo: string;
  gancho: string;
  escenas: { texto: string; keywords: string[] }[];
  hashtags: string[];
  /** Ganchos virales para la descripción; el primero la encabeza. */
  ganchos?: string[];
  categoria?: string | null;
  subcategoria?: string | null;
  premisa?: Premisa | null;
  keywords?: string[];
  motorUsado?: string;
  avisoMotor?: string;
};

export type ModoPublicacion = "DESCARGA" | "BORRADOR_TIKTOK" | "DIRECTO_TIKTOK";

export type Serie = {
  id: string;
  nombre: string;
  tipo: "Reflexion" | "Historia";
  temas: string[];
  duracion: number;
  idioma: Idioma;
  region: Region;
  modismos: boolean;
  partes: number;
  categoria: string | null;
  subcategoria: string | null;
  /** Bancos de imagen elegidos; vacío = los de la categoría. */
  bancos?: string[];
  medios?: string[];
  cron: string;
  zonaHoraria: string;
  motor: string;
  modelo: string | null;
  voz: Voz;
  musica: string | null;
  musicaModo: "FIJA" | "ROTAR";
  modoAudio: ModoAudio;
  segundosEscena: number | null;
  salida: "VIDEO" | "MONTAJE";
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
  estado: "GUION" | "CLIPS" | "VOZ" | "RENDER" | "LISTA" | "SUBIDA" | "MONTAJE" | "ERROR";
  titulo: string | null;
  categoria: string | null;
  subcategoria: string | null;
  /** En que idioma se escribio; la continuacion hereda este. */
  idioma?: Idioma;
  parte: number;
  continuaDeId: string | null;
  ganchoTexto: string | null;
  /** Ganchos virales de la descripción; el primero es el que se usó. */
  ganchos?: string[];
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
