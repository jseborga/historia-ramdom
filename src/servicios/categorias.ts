/**
 * Categorías y subcategorías de historia. Sirven para tres cosas:
 *   1. Elegir al azar (o a mano) el tipo de historia antes de escribirla.
 *   2. Darle al modelo el tono y las reglas del género en el prompt.
 *   3. Buscar clips que peguen con el ambiente, aunque la escena no lo diga.
 *
 * Van en dos áreas, porque no se escriben igual:
 *   - **Historias** (ficción): un personaje, un conflicto y un giro final.
 *   - **Ideas**: literatura, Nobel, filosofía, poder, economía, negocios y
 *     estafas. Ahí no hay trama que inventar: hay una idea de alguien, un
 *     ejemplo que la baja a tierra y una objeción que la pone a prueba.
 *
 * Los textos van con tildes a propósito: el prompt se arma con ellos y un
 * prompt sin tildes hace que el modelo escriba sin tildes.
 */

import type { Banco, TipoMedio } from "./clips.js";

export type Subcategoria = {
  id: string;
  nombre: string;
  /** Pista breve para el modelo: qué suele tener una historia de este tipo. */
  pista: string;
};

/** Ficción (historias inventadas) o ideas (pensamiento y divulgación). */
export type Area = "ficcion" | "ideas";

export const AREAS: { id: Area; nombre: string; nota: string }[] = [
  {
    id: "ficcion",
    nombre: "Historias",
    nota: "Ficción: personajes, conflicto y un giro final.",
  },
  {
    id: "ideas",
    nombre: "Ideas y pensamiento",
    nota: "Libros, filosofía, poder, dinero y engaños: una idea explicada con ejemplos.",
  },
];

export type Categoria = {
  id: string;
  nombre: string;
  area: Area;
  /** Tono y reglas del género, en una o dos frases. */
  tono: string;
  subcategorias: Subcategoria[];
  /** Palabras EN INGLÉS para buscar clips con el ambiente de la categoría. */
  visual: string[];
  /** Hashtags cortos, sin almohadilla. */
  hashtags: string[];
  /**
   * Reglas extra que van al prompt tal cual. Aquí es donde se sostiene el
   * límite de las categorías delicadas (estafas: se explica para reconocerlas,
   * nunca para montarlas).
   */
  reglas?: string[];
  /**
   * Obras, autores o casos de donde puede salir la idea. Se sortean unos
   * cuantos en cada planteamiento para que no salga siempre el mismo.
   */
  fuentes?: string[];
  /**
   * Dónde buscar la imagen de esta categoría. Vacío = donde siempre (Pexels y
   * Pixabay). La ciencia busca además en la NASA, que es de dominio público y
   * tiene el material de verdad: planetas, lanzamientos, la Tierra desde fuera.
   */
  bancos?: Banco[];
  /**
   * Qué medios admite. Vacío = solo vídeo. Con "imagen" entran fotos, que en
   * el render se animan con Ken Burns en vez de quedarse quietas.
   */
  medios?: TipoMedio[];
};

/** Dónde buscar y qué admitir para una categoría; vacío = los valores de siempre. */
export function mediosDeCategoria(id?: string | null): { bancos?: Banco[]; medios?: TipoMedio[] } {
  const c = id ? CATEGORIAS.find((x) => x.id === id) : null;
  return { bancos: c?.bancos, medios: c?.medios };
}

const sub = (id: string, nombre: string, pista: string): Subcategoria => ({ id, nombre, pista });

type SinArea = Omit<Categoria, "area">;
const conArea = (area: Area, xs: SinArea[]): Categoria[] => xs.map((c) => ({ ...c, area }));

/** Ficción: las de siempre. */
const FICCION: SinArea[] = [
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
    // Los cuentos de ciencia salen mejor con material de la NASA que con
    // animaciones genéricas de banco: es real, es suyo y es de dominio público.
    bancos: ["nasa", "pexels", "pixabay"],
    medios: ["video", "imagen"],
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

/**
 * Ideas y pensamiento: libros, filosofía, poder, dinero y engaños. No se
 * inventa una trama, se explica una idea de alguien: de dónde sale, qué
 * ejemplo la baja a tierra y qué objeción la pone a prueba.
 */
const IDEAS: SinArea[] = [
  {
    id: "literatura",
    nombre: "Literatura clásica",
    tono:
      "Una idea grande de un libro, contada para quien no lo ha leído: qué plantea y por qué sigue doliendo hoy. " +
      "No es un resumen escolar ni una reseña; es la idea del libro puesta en la vida de quien mira.",
    reglas: [
      "Nombra la obra y a su autor en las primeras frases: sin eso el vídeo no vale.",
      "Como mucho UNA cita textual, corta y entre comillas, con el nombre del autor; el resto, con tus palabras.",
      "No inventes citas, personajes ni argumentos. Si no estás seguro de una frase, explica la idea sin comillas.",
      "Si destripas el final de la obra, avisa antes en la misma frase.",
      "Cierra bajando la idea a algo que le pase a quien está mirando.",
    ],
    subcategorias: [
      sub("clasicos", "Clásicos universales", "una novela que todo el mundo cita y casi nadie ha leído, y la idea que la sostiene"),
      sub("rusa", "Novela rusa", "culpa, castigo, fe y dinero en Dostoyevski, Tolstói o Chéjov"),
      sub("latinoamericana", "Latinoamericana", "realismo mágico, memoria y poder en la novela latinoamericana"),
      sub("griega", "Tragedia griega y mito", "un mito antiguo que explica algo que sigue pasando"),
      sub("distopia", "Distopías", "libros que imaginaron un futuro y acertaron más de lo que quisiéramos"),
      sub("poesia", "Poesía", "un poema y la imagen que se queda pegada durante años"),
      sub("personaje", "Personajes inolvidables", "un personaje y la decisión que lo define"),
    ],
    fuentes: [
      "Don Quijote, de Cervantes",
      "Crimen y castigo, de Dostoyevski",
      "Anna Karénina, de Tolstói",
      "La metamorfosis, de Kafka",
      "Hamlet, de Shakespeare",
      "La Odisea, de Homero",
      "Antígona, de Sófocles",
      "Moby Dick, de Melville",
      "Orgullo y prejuicio, de Jane Austen",
      "Frankenstein, de Mary Shelley",
      "El retrato de Dorian Gray, de Oscar Wilde",
      "Madame Bovary, de Flaubert",
      "1984, de George Orwell",
      "Un mundo feliz, de Aldous Huxley",
      "El extranjero, de Albert Camus",
      "Pedro Páramo, de Juan Rulfo",
    ],
    visual: ["old books library", "handwritten letter", "candle on desk night", "rain window reading", "dusty bookshelf", "typewriter close up"],
    hashtags: ["literatura", "libros", "clasicos"],
    medios: ["video", "imagen"],
  },
  {
    id: "nobel",
    nombre: "Premios Nobel",
    tono:
      "Una idea o una vida premiada con el Nobel contada en un minuto: qué hizo, por qué importó y qué queda de eso. " +
      "Tono de divulgación seria, con datos que se puedan sostener.",
    reglas: [
      "Nombra a la persona, el Nobel que ganó y por qué se lo dieron.",
      "Si no estás seguro del año, del país o de una cifra, no lo digas: la idea vale más que el dato dudoso.",
      "No atribuyas frases que no puedas sostener; mejor parafrasear que inventar una cita.",
      "Nada de juzgar la vida privada de personas vivas.",
    ],
    subcategorias: [
      sub("literatura", "Nobel de Literatura", "un autor premiado y el libro por el que hay que empezar"),
      sub("discurso", "Discursos de aceptación", "lo que dijo al recibirlo y por qué se sigue recordando"),
      sub("latam", "Nobel latinoamericanos", "García Márquez, Neruda, Mistral, Asturias o Paz y lo que contaron"),
      sub("paz", "Nobel de la Paz", "alguien que se jugó algo de verdad y por qué se lo reconocieron"),
      sub("ciencia", "Nobel de ciencia", "un descubrimiento explicado sin fórmulas y lo que cambió en la vida diaria"),
      sub("rechazo", "Los que dijeron que no", "quien rechazó el premio, o lo recibió demasiado tarde, y por qué"),
    ],
    fuentes: [
      "Gabriel García Márquez",
      "Pablo Neruda",
      "Gabriela Mistral",
      "Miguel Ángel Asturias",
      "Albert Camus",
      "José Saramago",
      "Toni Morrison",
      "Hermann Hesse",
      "Kazuo Ishiguro",
      "Wisława Szymborska",
      "Svetlana Aleksiévich",
      "Marie Curie",
      "Nelson Mandela",
      "Malala Yousafzai",
      "Richard Feynman",
    ],
    visual: ["gold medal close up", "old auditorium", "writer typewriter", "winter city europe", "archive photographs", "laboratory vintage"],
    hashtags: ["nobel", "literatura", "ideas"],
    bancos: ["pexels", "pixabay", "nasa"],
    medios: ["video", "imagen"],
  },
  {
    id: "filosofia",
    nombre: "Filosofía",
    tono:
      "Una idea filosófica explicada con un ejemplo de hoy, no con jerga. Se plantea el problema, se da la idea, " +
      "se pone a prueba con la objeción más fuerte y se cierra con algo que incomoda. Sin sermón y sin autoayuda.",
    reglas: [
      "Di de qué pensador o de qué corriente viene la idea; la filosofía sin nombre es una frase de taza.",
      "Un ejemplo cotidiano y concreto: sin él el vídeo se cae.",
      "No conviertas la idea en receta de éxito ni en consejo motivacional.",
      "Reconoce la objeción más fuerte a la idea en vez de esconderla.",
      "Nada de decirle a nadie cómo debe vivir: se plantea, no se ordena.",
    ],
    subcategorias: [
      sub("estoicismo", "Estoicismo", "lo que depende de ti y lo que no, sin la versión de coach de redes"),
      sub("existencialismo", "Existencialismo", "libertad, angustia y la responsabilidad de elegir"),
      sub("absurdo", "El absurdo y el sentido", "vivir sin ninguna garantía de que esto signifique algo"),
      sub("etica", "Ética y dilemas", "un dilema moral que no tiene salida limpia"),
      sub("verdad", "Verdad y conocimiento", "cómo sabemos lo que creemos saber, y por qué nos engañamos"),
      sub("sospecha", "Sospecha y crítica", "Nietzsche, Marx o Freud: lo que se esconde detrás de lo que decimos"),
      sub("oriental", "Pensamiento oriental", "taoísmo y budismo: soltar, fluir, atender"),
      sub("tecnologia", "Filosofía y tecnología", "atención, algoritmos y qué nos está haciendo la pantalla"),
    ],
    fuentes: [
      "Marco Aurelio y las Meditaciones",
      "Epicteto y lo que está en nuestro poder",
      "Séneca y la brevedad de la vida",
      "Sócrates y la vida examinada",
      "Platón y el mito de la caverna",
      "Aristóteles y el término medio",
      "Epicuro y el placer sereno",
      "Diógenes el cínico",
      "Spinoza y las pasiones",
      "Kant y el imperativo categórico",
      "Schopenhauer y la voluntad",
      "Kierkegaard y la angustia",
      "Nietzsche y el eterno retorno",
      "Sartre y la condena a ser libres",
      "Simone de Beauvoir",
      "Hannah Arendt y la banalidad del mal",
      "Camus y el mito de Sísifo",
      "Lao Tsé y el Tao Te King",
      "Byung-Chul Han y la sociedad del cansancio",
    ],
    visual: ["ancient statue", "stone columns", "person thinking by window", "chess pieces", "sunrise mountains", "candle flame dark", "empty road horizon"],
    hashtags: ["filosofia", "pensamiento", "reflexion"],
    medios: ["video", "imagen"],
  },
  {
    id: "politica",
    nombre: "Política y poder",
    tono:
      "Cómo se consigue, se conserva y se pierde el poder: el mecanismo, con casos históricos y con ideas. " +
      "Se explica cómo funciona, no a quién apoyar.",
    reglas: [
      "Nada de partidos, candidatos ni gobiernos actuales: casos históricos o el mecanismo en abstracto.",
      "No le digas a nadie a quién votar ni qué pensar; el vídeo explica, no hace campaña.",
      "Si un hecho admite dos lecturas serias, di las dos.",
      "Nada de teorías conspirativas: lo que se cuenta tiene que estar documentado.",
    ],
    subcategorias: [
      sub("estrategia", "Estrategia y Maquiavelo", "las reglas del poder que nadie dice en voz alta"),
      sub("propaganda", "Propaganda y manipulación", "cómo se fabrica una opinión de masas y cómo se reconoce"),
      sub("totalitarismo", "Totalitarismo y libertad", "cómo un país normal deja de serlo, paso a paso"),
      sub("democracia", "Democracia y sus grietas", "por qué la mayoría a veces se equivoca y qué se inventó para frenarlo"),
      sub("revoluciones", "Revoluciones", "qué pasa el día después de ganar"),
      sub("caidas", "Caídas del poder", "el error que tumbó a alguien que parecía intocable"),
      sub("imperios", "Imperios", "cómo se levantan y por qué siempre terminan cayendo"),
    ],
    fuentes: [
      "El príncipe, de Maquiavelo",
      "El arte de la guerra, de Sun Tzu",
      "La república, de Platón",
      "El Leviatán, de Hobbes",
      "El contrato social, de Rousseau",
      "Los orígenes del totalitarismo, de Hannah Arendt",
      "1984, de George Orwell",
      "Rebelión en la granja, de Orwell",
      "La sociedad abierta y sus enemigos, de Popper",
      "Vigilar y castigar, de Foucault",
      "Tucídides y la guerra del Peloponeso",
      "La caída de la República romana",
    ],
    visual: ["parliament building", "crowd protest", "chess king piece", "old world map", "microphone podium", "city aerial night", "marble hall"],
    hashtags: ["poder", "politica", "historia"],
    medios: ["video", "imagen"],
  },
  {
    id: "economia",
    nombre: "Economía",
    tono:
      "Una idea económica explicada con la vida real: precios, deudas, crisis e incentivos. " +
      "Se entiende sin saber economía y no se le dice a nadie qué hacer con su dinero.",
    reglas: [
      "Nunca des recomendaciones de inversión ni digas dónde poner el dinero.",
      "Si usas cifras, que sean aproximadas y verificables; mejor un orden de magnitud que un dato inventado.",
      "Explica el incentivo que hay detrás: eso es lo que la gente no ve.",
      "Nada de promesas de rentabilidad ni de 'lo que los bancos no quieren que sepas'.",
    ],
    subcategorias: [
      sub("burbujas", "Burbujas y crisis", "de los tulipanes a 2008: la misma historia con otro nombre"),
      sub("inflacion", "Dinero e inflación", "por qué el dinero vale menos cada año y quién gana con eso"),
      sub("incentivos", "Incentivos", "la gente no hace lo que le dices, hace lo que le conviene"),
      sub("desigualdad", "Desigualdad", "por qué el que tiene acumula, y qué se ha probado para frenarlo"),
      sub("trabajo", "Trabajo y salarios", "qué decide de verdad lo que te pagan"),
      sub("juegos", "Teoría de juegos", "decisiones en las que lo que hace el otro lo cambia todo"),
      sub("deuda", "Deuda", "quién le debe a quién y qué pasa cuando no se puede pagar"),
    ],
    fuentes: [
      "La riqueza de las naciones, de Adam Smith",
      "Keynes y la demanda agregada",
      "La burbuja de los tulipanes de 1637",
      "El crac de 1929",
      "La hiperinflación alemana de 1923",
      "La crisis financiera de 2008",
      "El dilema del prisionero",
      "La tragedia de los comunes",
      "Kahneman y la economía del comportamiento",
      "Piketty y la concentración del capital",
      "La ley de Gresham: la moneda mala desplaza a la buena",
    ],
    visual: ["stock market screen", "coins stack", "shipping port containers", "empty supermarket shelf", "financial district", "printing money press"],
    hashtags: ["economia", "dinero", "finanzas"],
    medios: ["video", "imagen"],
  },
  {
    id: "negocios",
    nombre: "Negocios y estrategia",
    tono:
      "Una decisión de negocio y sus consecuencias: qué se jugaban, qué eligieron y qué se aprende. " +
      "Casos concretos, sin frases de gurú ni promesas de hacerse rico.",
    reglas: [
      "Nada de promesas de ingresos ni de fórmulas para hacerse rico.",
      "Cuenta también lo que salió mal: el fracaso enseña más que el éxito.",
      "Si hablas de una empresa conocida, quédate en hechos públicos y comprobables.",
      "Nada de trucos para saltarse impuestos, contratos o leyes.",
    ],
    subcategorias: [
      sub("fracasos", "Fracasos famosos", "una empresa enorme que desapareció y la decisión que la mató"),
      sub("modelo", "Modelos de negocio", "de dónde sale el dinero de verdad en un negocio que parece gratis"),
      sub("fundadores", "Fundadores", "la decisión que tomaron cuando todavía no tenían nada"),
      sub("competencia", "Competencia y monopolio", "cómo se gana un mercado y cómo se cierra la puerta detrás"),
      sub("persuasion", "Marketing y persuasión", "por qué compras lo que no ibas a comprar"),
      sub("precios", "Precios", "por qué cuesta lo que cuesta"),
      sub("pyme", "Negocio pequeño", "lo que decide que un negocio de barrio dure o cierre"),
    ],
    fuentes: [
      "Kodak y la cámara digital que archivó",
      "Blockbuster frente a Netflix",
      "Nokia y la llegada del iPhone",
      "Ford y la cadena de montaje",
      "El modelo de la maquinilla y las cuchillas",
      "El efecto de red",
      "La larga cola de productos poco vendidos",
      "El dilema del innovador, de Christensen",
      "Toyota y la mejora continua",
      "El coste hundido y por qué nos aferramos a lo que ya gastamos",
    ],
    visual: ["office meeting", "warehouse boxes", "small shop owner", "business district morning", "handshake deal", "closed store sign"],
    hashtags: ["negocios", "emprender", "estrategia"],
    medios: ["video", "imagen"],
  },
  {
    id: "estafas",
    nombre: "Trampas y estafas (para reconocerlas)",
    tono:
      "Cómo funciona un engaño visto desde fuera, para poder olerlo a tiempo. Se cuenta desde quien lo sufre o " +
      "desde quien lo destapa, se nombra la señal que lo delata y se dice qué hacer. Nunca es un manual para montarlo.",
    reglas: [
      "Cuéntalo desde el lado de quien lo sufre o de quien lo descubre, nunca desde quien lo monta.",
      "Prohibido dar pasos, guiones, plantillas o herramientas que sirvan para ejecutar el engaño: se explica el mecanismo a grandes rasgos, jamás la receta.",
      "Termina siempre con la señal de alarma concreta y qué hacer: qué no firmar, qué no enviar, a quién avisar.",
      "Nada de empresas, personas ni casos reales identificables: los nombres son inventados.",
      "No asustes por asustar ni humilles a la víctima: cae gente lista todos los días, y ese es justo el punto.",
    ],
    subcategorias: [
      sub("piramide", "Pirámides y esquemas Ponzi", "el negocio que paga a los primeros con el dinero de los últimos"),
      sub("inversion", "Inversiones milagro", "rentabilidad garantizada, urgencia y un grupo de mensajería"),
      sub("suplantacion", "Suplantación y phishing", "el mensaje del banco que no es del banco"),
      sub("romance", "Estafa romántica", "meses de cariño y una emergencia que necesita dinero"),
      sub("letrapequena", "Letra pequeña", "el contrato que dice lo contrario de lo que te prometieron"),
      sub("laboral", "Ofertas de trabajo falsas", "el empleo que te pide pagar antes de empezar"),
      sub("sesgos", "Por qué caemos", "urgencia, autoridad, vergüenza y esperanza: los resortes que usan"),
      sub("trampas", "Trampas legales pero sucias", "prácticas que no son delito y aun así te sacan el dinero"),
    ],
    fuentes: [
      "El esquema original de Charles Ponzi, en 1920",
      "Las cadenas de cartas y el timo de la estampita",
      "El multinivel que vive de reclutar, no de vender",
      "Los principios de persuasión de Cialdini: reciprocidad, autoridad, escasez",
      "El sesgo de urgencia: decidir rápido para no pensar",
      "La prueba social falsa: testimonios comprados",
      "Los patrones oscuros de las suscripciones difíciles de cancelar",
    ],
    visual: ["phone message screen", "contract signature close up", "money envelope", "laptop dark room", "worried person phone", "empty office chairs"],
    hashtags: ["estafas", "cuidado", "finanzaspersonales"],
  },
];

export const CATEGORIAS: Categoria[] = [...conArea("ficcion", FICCION), ...conArea("ideas", IDEAS)];

/** Las categorías de un área, para agrupar los selectores. */
export const categoriasDeArea = (area: Area) => CATEGORIAS.filter((c) => c.area === area);

/** Valor especial: elegir una categoría distinta cada vez. */
export const CATEGORIA_ALEATORIA = "aleatoria";

/** Al azar, pero sin salir del área: `aleatoria:ideas`, `aleatoria:ficcion`. */
export const aleatoriaDeArea = (area: Area) => `${CATEGORIA_ALEATORIA}:${area}`;

/** Área de un valor "aleatoria[:area]"; null si no es un valor al azar. */
function areaAleatoria(id: string): { esAleatoria: boolean; area: Area | null } {
  if (id === CATEGORIA_ALEATORIA) return { esAleatoria: true, area: null };
  const area = AREAS.find((a) => aleatoriaDeArea(a.id) === id)?.id ?? null;
  return { esAleatoria: area !== null, area };
}

export const buscarCategoria = (id?: string | null) =>
  id ? CATEGORIAS.find((c) => c.id === id) ?? null : null;

export const esCategoriaValida = (id: string) =>
  areaAleatoria(id).esAleatoria || CATEGORIAS.some((c) => c.id === id);

const alAzar = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

/**
 * Resuelve la pareja categoría/subcategoría: `aleatoria` (o `aleatoria:ideas`,
 * que no se sale del área) elige una al azar; subcategoría vacía elige una de
 * la categoría. Devuelve null si no se pidió categoría (tema libre).
 */
export function resolverCategoria(
  categoria?: string | null,
  subcategoria?: string | null,
): { categoria: Categoria; subcategoria: Subcategoria } | null {
  if (!categoria) return null;
  const azar = areaAleatoria(categoria);
  const cat = azar.esAleatoria
    ? alAzar(azar.area ? categoriasDeArea(azar.area) : CATEGORIAS)
    : buscarCategoria(categoria);
  if (!cat) throw new Error(`Categoría desconocida: ${categoria}`);
  const s = (subcategoria && cat.subcategorias.find((x) => x.id === subcategoria)) || alAzar(cat.subcategorias);
  return { categoria: cat, subcategoria: s };
}

/**
 * Unas cuantas fuentes de la categoría, barajadas. Se pasan al modelo como
 * punto de partida: sin esto, "filosofía al azar" sale siempre Marco Aurelio.
 */
export function fuentesAlAzar(c: Categoria, cuantas = 6): string[] {
  const xs = [...(c.fuentes ?? [])];
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs.slice(0, cuantas);
}

/** Lo que el frontend necesita para los selectores. */
export const catalogoCategorias = () =>
  CATEGORIAS.map((c) => ({
    id: c.id,
    nombre: c.nombre,
    area: c.area,
    tono: c.tono,
    subcategorias: c.subcategorias.map((s) => ({ id: s.id, nombre: s.nombre, pista: s.pista })),
  }));

/** Las áreas con su valor "al azar", para agrupar los selectores. */
export const catalogoAreas = () =>
  AREAS.map((a) => ({ id: a.id, nombre: a.nombre, nota: a.nota, aleatoria: aleatoriaDeArea(a.id) }));
