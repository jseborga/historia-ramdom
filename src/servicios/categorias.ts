/**
 * Categorías y subcategorías de historia. Sirven para tres cosas:
 *   1. Elegir al azar (o a mano) el tipo de historia antes de escribirla.
 *   2. Darle al modelo el tono y las reglas del género en el prompt.
 *   3. Buscar clips que peguen con el ambiente, aunque la escena no lo diga.
 *
 * Los textos van con tildes a propósito: el prompt se arma con ellos y un
 * prompt sin tildes hace que el modelo escriba sin tildes.
 */

export type Subcategoria = {
  id: string;
  nombre: string;
  /** Pista breve para el modelo: qué suele tener una historia de este tipo. */
  pista: string;
};

export type Categoria = {
  id: string;
  nombre: string;
  /** Tono y reglas del género, en una o dos frases. */
  tono: string;
  subcategorias: Subcategoria[];
  /** Palabras EN INGLÉS para buscar clips con el ambiente de la categoría. */
  visual: string[];
  /** Hashtags cortos, sin almohadilla. */
  hashtags: string[];
};

const sub = (id: string, nombre: string, pista: string): Subcategoria => ({ id, nombre, pista });

export const CATEGORIAS: Categoria[] = [
  {
    id: "comedia",
    nombre: "Comedia",
    tono: "Humor ligero y ritmo rápido; el remate final es lo más importante. Nada de crueldad ni burlas a grupos.",
    subcategorias: [
      sub("absurdo", "Situación absurda", "una situación cotidiana que se descontrola de forma ridícula"),
      sub("malentendido", "Malentendido", "dos personas entienden cosas distintas y nadie se da cuenta hasta el final"),
      sub("familia", "Familia y pareja", "anécdota de familia, suegros, hermanos o pareja con final gracioso"),
      sub("trabajo", "Trabajo y oficina", "jefes, clientes o compañeros en una escena de trabajo que se vuelve cómica"),
      sub("torpeza", "Metida de pata", "alguien intenta quedar bien y consigue exactamente lo contrario"),
      sub("animales", "Animales", "una mascota o un animal callejero con más criterio que las personas"),
    ],
    visual: ["friends laughing", "city street daytime", "office people", "family dinner", "funny dog"],
    hashtags: ["humor", "risas", "comedia"],
  },
  {
    id: "drama",
    nombre: "Drama",
    tono: "Emoción contenida, personajes con motivos claros y un final que duele o consuela. Sin melodrama gratuito.",
    subcategorias: [
      sub("perdida", "Pérdida y duelo", "alguien pierde a una persona, un lugar o una etapa y aprende a seguir"),
      sub("familia", "Secretos de familia", "una verdad guardada durante años sale a la luz"),
      sub("decision", "Decisión difícil", "una elección entre dos caminos que no admiten vuelta atrás"),
      sub("reencuentro", "Reencuentro", "dos personas separadas por el tiempo o la distancia vuelven a verse"),
      sub("sacrificio", "Sacrificio", "alguien renuncia a algo suyo por otra persona"),
    ],
    visual: ["rain on window", "person alone at night", "empty road", "old photographs", "hospital corridor"],
    hashtags: ["drama", "historia", "emociones"],
  },
  {
    id: "terror",
    nombre: "Terror",
    tono: "Tensión que crece despacio, detalles concretos y un giro final inquietante. Sugiere más de lo que muestra; sin gore.",
    subcategorias: [
      sub("casa", "Casa embrujada", "ruidos, objetos que cambian de sitio y una presencia en una casa nueva"),
      sub("carretera", "Carretera de noche", "un viaje nocturno, un desvío y algo que no debería estar ahí"),
      sub("leyenda", "Leyenda urbana", "una historia que todos conocen en el barrio y resulta ser cierta"),
      sub("tecnologia", "Tecnología", "mensajes, cámaras o aplicaciones que muestran lo que no puede ser"),
      sub("bosque", "Bosque y montaña", "acampada, niebla, un sendero que no lleva a donde debería"),
      sub("ritual", "Ritual y maldición", "una regla que no se debía romper y las consecuencias de romperla"),
    ],
    visual: ["dark hallway", "foggy forest night", "abandoned house", "flickering light", "empty road night", "old door"],
    hashtags: ["terror", "miedo", "historiasdeterror"],
  },
  {
    id: "real",
    nombre: "Historia real",
    tono: "Contado como un caso verídico: fechas, lugares y detalles verosímiles, tono de crónica. Si es inventada, que suene creíble sin nombrar a personas reales identificables.",
    subcategorias: [
      sub("caso", "Caso que dio la vuelta al mundo", "un suceso documentado, contado de principio a fin con su desenlace"),
      sub("desaparicion", "Desaparición", "alguien que desaparece y las pistas que quedaron"),
      sub("supervivencia", "Supervivencia", "una persona atrapada en el mar, la montaña o la selva que sobrevive"),
      sub("coincidencia", "Coincidencia increíble", "dos hechos que no deberían cruzarse y se cruzan"),
      sub("historia", "Hecho histórico", "un episodio poco conocido de la historia con un detalle sorprendente"),
    ],
    visual: ["newspaper archive", "city aerial", "documents on desk", "old footage street", "ocean waves"],
    hashtags: ["historiareal", "casosreales", "sabiasque"],
  },
  {
    id: "triunfo",
    nombre: "Triunfo y superación",
    tono: "Alguien que empieza abajo y llega lejos; obstáculos concretos, esfuerzo visible y una recompensa ganada. Inspirador sin frases de póster.",
    subcategorias: [
      sub("deporte", "Deporte", "un deportista que nadie tomaba en serio y el día que demostró lo contrario"),
      sub("negocio", "Emprender desde cero", "un negocio que empezó con nada, en la calle o en casa"),
      sub("estudio", "Estudiar contra todo", "alguien que estudia de noche, sin recursos, y lo consigue"),
      sub("salud", "Vencer una enfermedad", "un diagnóstico duro y la forma de salir adelante"),
      sub("migracion", "Empezar en otro país", "llegar sin nada a un lugar desconocido y hacerse un sitio"),
    ],
    visual: ["sunrise running", "mountain summit", "hands working", "city lights night", "person studying lamp"],
    hashtags: ["superacion", "motivacion", "inspiracion"],
  },
  {
    id: "engano",
    nombre: "Engaño y traición",
    tono: "Una confianza traicionada y el momento en que se descubre. El público debe ver las señales antes que el personaje.",
    subcategorias: [
      sub("estafa", "Estafa", "un timo bien montado y cómo cayó (o no) la víctima"),
      sub("infidelidad", "Infidelidad", "una pareja, una mentira y el detalle que la delata"),
      sub("socio", "Socio traidor", "un negocio entre amigos y el que se quedó con todo"),
      sub("impostor", "Impostor", "alguien que fingió ser quien no era durante años"),
      sub("venganza", "Venganza", "la víctima del engaño le da la vuelta a la situación"),
    ],
    visual: ["handshake business", "phone screen dark", "money counting", "person looking back", "city night rain"],
    hashtags: ["traicion", "engano", "historias"],
  },
  {
    id: "misterio",
    nombre: "Misterio",
    tono: "Una pregunta desde la primera frase y pistas dosificadas; la respuesta llega al final y encaja con todo lo anterior.",
    subcategorias: [
      sub("desaparecido", "Objeto o persona desaparecida", "algo que faltaba y dónde apareció"),
      sub("mensaje", "Mensaje sin explicación", "una carta, una nota o una llamada que nadie debería haber enviado"),
      sub("lugar", "Lugar extraño", "un sitio con reglas raras que nadie explica"),
      sub("detective", "Pequeño detective", "alguien común que resuelve un enigma fijándose en un detalle"),
    ],
    visual: ["foggy street", "magnifying glass", "old letter", "night window light", "empty train station"],
    hashtags: ["misterio", "enigma", "historias"],
  },
  {
    id: "romance",
    nombre: "Romance",
    tono: "Dos personas, un obstáculo y un gesto que lo cambia todo. Ternura sin cursilería; los detalles pequeños importan.",
    subcategorias: [
      sub("encuentro", "Primer encuentro", "cómo se conocieron dos personas de la forma menos esperada"),
      sub("distancia", "A distancia", "un amor separado por kilómetros o por años"),
      sub("segunda", "Segunda oportunidad", "dos personas que se dejaron y la vida las vuelve a cruzar"),
      sub("mayores", "Amor en la vejez", "una pareja mayor y lo que aprendieron en toda una vida"),
    ],
    visual: ["couple sunset", "holding hands", "coffee shop window", "city walk evening", "train station goodbye"],
    hashtags: ["amor", "romance", "historiasdeamor"],
  },
  {
    id: "aventura",
    nombre: "Aventura",
    tono: "Movimiento constante, un objetivo claro y peligro creíble. Cada escena avanza el viaje.",
    subcategorias: [
      sub("viaje", "Viaje", "un viaje que sale mal y termina siendo el mejor de la vida"),
      sub("expedicion", "Expedición", "un grupo que busca algo en un lugar remoto"),
      sub("rescate", "Rescate", "alguien que va a buscar a otra persona contra el tiempo"),
      sub("tesoro", "Tesoro o hallazgo", "un mapa, una pista antigua y lo que había al final"),
    ],
    visual: ["mountain trail", "jungle river", "desert road", "boat ocean", "hiker cliff"],
    hashtags: ["aventura", "viajes", "explorar"],
  },
  {
    id: "reflexion",
    nombre: "Reflexión",
    tono: "Una idea sencilla contada con una historia mínima; termina con una frase que se recuerda, sin sermonear.",
    subcategorias: [
      sub("tiempo", "El tiempo", "lo que se va y lo que se queda"),
      sub("familia", "Padres e hijos", "algo que un padre o una madre entendió tarde, o a tiempo"),
      sub("dinero", "Dinero y éxito", "lo que el dinero compra y lo que no"),
      sub("amistad", "Amistad", "un amigo que estuvo cuando nadie más estaba"),
      sub("simple", "Vida simple", "un gesto pequeño que cambia un día entero"),
    ],
    visual: ["sunset field", "ocean calm", "old hands", "forest light", "window morning"],
    hashtags: ["reflexion", "vida", "pensamientos"],
  },
  {
    id: "curiosidades",
    nombre: "Ciencia y curiosidades",
    tono: "Un dato sorprendente explicado con una historia; preciso, sin inventar cifras, con una pregunta que engancha.",
    subcategorias: [
      sub("cuerpo", "Cuerpo humano", "algo del cuerpo que casi nadie sabe"),
      sub("espacio", "Espacio", "planetas, estrellas y lo que pasa allá arriba"),
      sub("animales", "Animales", "una especie con una habilidad increíble"),
      sub("inventos", "Inventos", "cómo se inventó algo cotidiano, por accidente o por terquedad"),
      sub("historia", "Curiosidad histórica", "un detalle de la historia que parece mentira"),
    ],
    visual: ["space stars", "microscope lab", "wild animals", "old machinery", "science abstract"],
    hashtags: ["curiosidades", "sabiasque", "ciencia"],
  },
  {
    id: "crimen",
    nombre: "Crimen",
    tono: "Estilo de crónica policial: hechos, tiempos y la pista que lo resolvió. Sin recrearse en la violencia.",
    subcategorias: [
      sub("robo", "Robo perfecto", "un robo planeado al detalle y el fallo que lo delató"),
      sub("fuga", "Fuga", "alguien que escapó y cómo lo encontraron"),
      sub("frio", "Caso sin resolver", "un caso abierto y las teorías que quedan"),
      sub("detective", "El investigador", "la persona que no soltó el caso cuando todos lo daban por perdido"),
    ],
    visual: ["police lights night", "city alley", "evidence board", "courthouse", "car night road"],
    hashtags: ["crimen", "casos", "misterio"],
  },
];

/** Valor especial: elegir una categoría distinta cada vez. */
export const CATEGORIA_ALEATORIA = "aleatoria";

export const buscarCategoria = (id?: string | null) =>
  id ? CATEGORIAS.find((c) => c.id === id) ?? null : null;

export const esCategoriaValida = (id: string) =>
  id === CATEGORIA_ALEATORIA || CATEGORIAS.some((c) => c.id === id);

const alAzar = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/**
 * Resuelve la pareja categoría/subcategoría: `aleatoria` o vacío en la
 * categoría elige una al azar; subcategoría vacía elige una de la categoría.
 * Devuelve null si no se pidió categoría (tema libre, como siempre).
 */
export function resolverCategoria(
  categoria?: string | null,
  subcategoria?: string | null,
): { categoria: Categoria; subcategoria: Subcategoria } | null {
  if (!categoria) return null;
  const cat = categoria === CATEGORIA_ALEATORIA ? alAzar(CATEGORIAS) : buscarCategoria(categoria);
  if (!cat) throw new Error(`Categoría desconocida: ${categoria}`);
  const s = (subcategoria && cat.subcategorias.find((x) => x.id === subcategoria)) || alAzar(cat.subcategorias);
  return { categoria: cat, subcategoria: s };
}

/** Lo que el frontend necesita para los selectores. */
export const catalogoCategorias = () =>
  CATEGORIAS.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    tono: c.tono,
    subcategorias: c.subcategorias.map((s) => ({ id: s.id, nombre: s.nombre })),
  }));
