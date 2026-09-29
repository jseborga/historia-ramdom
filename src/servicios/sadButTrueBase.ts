/**
 * La base con la que arranca el banco de "Sad but true".
 *
 * Un sorteo necesita un bombo lleno: con dos palabras no hay azar que valga.
 * Por eso la app no empieza vacía —seis familias de ocho palabras cada una, y
 * dos docenas de remates— y a partir de ahí crece sola: cada vídeo escrito con
 * IA y cada frase pegada a mano se quedan dentro.
 *
 * Las familias son lo importante. Las ocho palabras de una familia tienen que
 * poder salir en el mismo sorteo sin que se note el truco: si una es "el
 * gimnasio" y otra "el divorcio de mis padres", el sorteo deja de parecer un
 * sorteo. Por eso van agrupadas y el bombo se llena solo con las del mismo
 * tema.
 *
 * El tono es el del formato: la verdad que da una media sonrisa de lado. Nada
 * que empuje a rendirse ni que vaya contra nadie en concreto.
 */

export type ParejaBase = { palabra: string; texto: string; remate?: string };
export type FamiliaBase = { tema: string; seccion?: Seccion; parejas: ParejaBase[] };

/** Las tres secciones del formato. La de siempre es "triste". */
export type Seccion = "triste" | "motivacion" | "sarcasmo";

export const FAMILIAS: FamiliaBase[] = [
  {
    tema: "Lo que ibas a empezar",
    parejas: [
      { palabra: "El gimnasio", texto: "Pagaste enero entero para ir cuatro veces. El resto del año lo llamaste inversión." },
      { palabra: "Ese libro", texto: "Vas por la página 40 desde hace dos años. Ya no lo estás leyendo: lo estás decorando." },
      { palabra: "El curso de inglés", texto: "Lo compraste en oferta hace dos años. Sigue en la lección tres, y la oferta ya volvió cuatro veces." },
      { palabra: "Aprender guitarra", texto: "Te sabes el principio de tres canciones. Ninguna entera, y ya van seis años." },
      { palabra: "Ahorrar", texto: "Empiezas el mes que viene desde hace treinta meses. El mes que viene también existe para el banco." },
      { palabra: "Escribir", texto: "Tienes el título, el final y una carpeta con nueve primeras páginas distintas." },
      { palabra: "Levantarte temprano", texto: "Pusiste cinco alarmas. Te despertaste con la primera y negociaste con las otras cuatro." },
      { palabra: "Empezar el lunes", texto: "Llevas tantos lunes que si los juntaras te saldría el año que ibas a aprovechar." },
    ],
  },
  {
    tema: "Motivos para no llamar",
    parejas: [
      { palabra: "Es tarde allá", texto: "Nunca son las siete. Siempre es tarde, o temprano, o justo cuando ibas a hacer otra cosa." },
      { palabra: "Mañana con calma", texto: "Con calma significa nunca. Lo sabes tú y lo sabe quien está esperando la llamada." },
      { palabra: "Estoy cansado", texto: "Tienes energía para tres horas de vídeos cortos y ninguna para cuatro minutos de teléfono." },
      { palabra: "Hace mucho ya", texto: "Cuanto más esperas, más grande se hace la llamada, y más fácil es no hacerla." },
      { palabra: "No sabría qué decir", texto: "No hace falta decir nada. Por eso mismo da tanto miedo." },
      { palabra: "Seguro está ocupado", texto: "Lo estás decidiendo tú por él, que es la manera educada de no preguntar." },
      { palabra: "Cuando tenga buenas noticias", texto: "Llamas cuando hay algo que contar. Por eso pasan los años sin llamar." },
      { palabra: "Ya me escribirá", texto: "Está pensando exactamente lo mismo, y en eso los dos son igual de buenos." },
    ],
  },
  {
    tema: "Cosas que te dijeron de adulto",
    parejas: [
      { palabra: "Estudia algo seguro", texto: "Lo seguro cambió de nombre tres veces desde que te lo dijeron. Tú no." },
      { palabra: "Ya vendrá el ascenso", texto: "Llegó. Con el mismo sueldo, el doble de correos y una palabra nueva en la firma." },
      { palabra: "Es solo temporal", texto: "Llevas cuatro años en lo temporal. Lo definitivo nunca tuvo tanta constancia." },
      { palabra: "Cuando te independices", texto: "Te independizaste. Ahora la libertad se llama alquiler y vence el día cinco." },
      { palabra: "El tiempo lo cura", texto: "El tiempo no cura: entierra. Y a veces deja un pie fuera." },
      { palabra: "Los amigos de verdad quedan", texto: "Quedan tres. Y con dos hablas por cumpleaños, porque te lo recuerda el teléfono." },
      { palabra: "Haz lo que te gusta", texto: "Lo hiciste. Ahora es tu trabajo, y ya no te gusta los domingos por la tarde." },
      { palabra: "Ya descansarás", texto: "Es la frase que más veces se dice y la única que nadie cumple." },
    ],
  },
  {
    tema: "Lo que guardas por si acaso",
    parejas: [
      { palabra: "Esa caja de cables", texto: "Ninguno es de nada que tengas. Y aun así ninguno se tira, por si acaso." },
      { palabra: "La ropa de cuando", texto: "La guardas para el cuerpo que tenías. No para el que tienes, que va desnudo al armario." },
      { palabra: "Los apuntes de la carrera", texto: "Doce kilos de papel que no has abierto. Tirarlos sería admitir en qué se fue ese tiempo." },
      { palabra: "El regalo sin usar", texto: "Es demasiado bueno para usarlo. Tan bueno que lleva seis años nuevo, en su caja." },
      { palabra: "Las fotos sin mirar", texto: "Cuarenta mil fotos. Ninguna se mira, y borrar una parece una falta de respeto." },
      { palabra: "Ese mensaje sin contestar", texto: "Lo dejaste para responder bien. Ahora ya es tarde, y sigue ahí con su punto azul." },
      { palabra: "Las cosas de su casa", texto: "Sabes exactamente en qué cajón están. Y sabes que no vas a abrir el cajón." },
      { palabra: "La planta que no riegas", texto: "No está muerta: está esperando. Que es lo que hacen las cosas a tu alrededor." },
    ],
  },
  {
    tema: "Promesas que te haces solo",
    parejas: [
      { palabra: "Esta vez sí", texto: "Te lo has dicho tantas veces que ya ni tú te lo crees. Y aun así funciona un día y medio." },
      { palabra: "Solo cinco minutos más", texto: "Los cinco minutos son la unidad de tiempo más larga que existe." },
      { palabra: "Mañana ordeno", texto: "El desorden lleva tanto ahí que ya no lo ves. Solo lo ve quien viene." },
      { palabra: "Lo voy a hablar", texto: "Ensayas la conversación en la ducha. Ahí siempre la ganas." },
      { palabra: "Me lo tomo con calma", texto: "Te lo tomas con calma hasta las dos de la mañana, cuando te acuerdas de todo de golpe." },
      { palabra: "Después lo veo", texto: "Después es el sitio donde van las cosas a no pasar nunca." },
      { palabra: "El año que viene viajo", texto: "El año que viene tiene ya seis viajes, dos mudanzas y un idioma pendientes." },
      { palabra: "Esta noche duermo bien", texto: "Te acuestas a la hora. Y ahí, puntual, aparece todo lo que no pensaste en el día." },
    ],
  },
  {
    tema: "Lo que nadie te avisó",
    parejas: [
      { palabra: "Hacer amigos de grande", texto: "Nadie te avisó de que después de los treinta hay que pedir cita para todo, incluso para la amistad." },
      { palabra: "El domingo por la tarde", texto: "No es un día: es un aviso. Y llega puntual cincuenta y dos veces al año." },
      { palabra: "Volver a tu barrio", texto: "Sigue todo igual menos tú, y eso hace que parezca que se movió el barrio." },
      { palabra: "Las fotos de hace diez años", texto: "Te veías gordo, feo y perdido. Hoy darías cualquier cosa por volver a ese día." },
      { palabra: "Que tus padres envejecen", texto: "Un día empiezan a preguntarte a ti las cosas que antes les preguntabas tú." },
      { palabra: "El silencio de la casa", texto: "Querías vivir solo por el silencio. Nadie te dijo que el silencio también habla." },
      { palabra: "Las ganas de volver", texto: "Te fuiste para no volver. Y ahora vuelves cada vez que huele a algo de entonces." },
      { palabra: "Que nadie viene a buscarte", texto: "De adulto no hay quien te obligue a salir. Esa es toda la libertad y todo el problema." },
    ],
  },
];

/**
 * Motivación y sarcasmo, escritas en el formato que mejor le sienta al sorteo:
 * la frase **empieza por su palabra** y trae su propio cierre. Así el sorteo
 * se para en «La constancia», el vídeo remata «…le gana a las ganas todos los
 * martes» y el cierre es de esa frase y no de otra.
 *
 * Motivación sin frases de taza: nada de «tú puedes» ni «nunca te rindas»,
 * que se leen y se olvidan en el mismo segundo. Ánimo concreto, de los que se
 * pueden comprobar el martes siguiente.
 *
 * Sarcasmo contra uno mismo: lo que sabes que está mal y no quieres escuchar.
 * El blanco son los hábitos y las excusas de quien mira, nunca un grupo ni una
 * persona con nombre.
 */
export const FAMILIAS_NUEVAS: FamiliaBase[] = [
  {
    tema: "Lo que sí cuenta",
    seccion: "motivacion",
    parejas: [
      { palabra: "La constancia", texto: "La constancia le gana a las ganas todos los martes.", remate: "Nadie ve los días aburridos, pero son los que te cambian." },
      { palabra: "El primer paso", texto: "El primer paso no tiene que ser bueno: tiene que existir.", remate: "Hecho es mejor que perfecto, y mucho mejor que pendiente." },
      { palabra: "Cinco minutos", texto: "Cinco minutos al día son treinta horas al año.", remate: "Lo pequeño, repetido, deja de ser pequeño." },
      { palabra: "Empezar tarde", texto: "Empezar tarde sigue siendo empezar antes que mañana.", remate: "El mejor momento fue hace años. El segundo mejor es hoy." },
      { palabra: "Un mal día", texto: "Un mal día es un día, no el resumen de tu vida.", remate: "Mañana no te pide que olvides hoy, solo que vuelvas." },
      { palabra: "Pedir ayuda", texto: "Pedir ayuda es la parte valiente de no poder solo.", remate: "Nadie llegó lejos sin que alguien le abriera una puerta." },
      { palabra: "Tu ritmo", texto: "Tu ritmo no tiene que parecerse al de nadie para llevarte lejos.", remate: "No vas tarde: vas por tu camino." },
      { palabra: "Equivocarte", texto: "Equivocarte es la prueba de que lo estás intentando.", remate: "El que nunca se equivoca es porque se quedó mirando." },
    ],
  },
  {
    tema: "Lo que ya hiciste",
    seccion: "motivacion",
    parejas: [
      { palabra: "Lo que aguantaste", texto: "Lo que aguantaste es más de lo que te va a pedir mañana.", remate: "Si pudiste con aquello, esto también se puede." },
      { palabra: "Tu yo de hace un año", texto: "Tu yo de hace un año daría algo por estar donde estás.", remate: "Mira atrás solo para ver cuánto subiste." },
      { palabra: "Las cicatrices", texto: "Las cicatrices son lo que queda cuando sí sobreviviste.", remate: "Lo que dolió también enseñó." },
      { palabra: "Volver a empezar", texto: "Volver a empezar no es empezar de cero: es empezar sabiendo.", remate: "Nada de lo que aprendiste se pierde al caer." },
      { palabra: "El cansancio", texto: "El cansancio de hoy es la fuerza que vas a tener mañana.", remate: "Descansar también es avanzar." },
      { palabra: "Decir que no", texto: "Decir que no a lo que te apaga es decirte que sí a ti.", remate: "Tu tiempo es tuyo, aunque se te olvide." },
      { palabra: "Tus ganas", texto: "Tus ganas no se acabaron: solo están cansadas.", remate: "Duerme, come y vuelve. Siguen ahí." },
      { palabra: "Lo que te hace distinto", texto: "Lo que te hace distinto es lo que van a recordar.", remate: "Nadie se acuerda de los que se parecían a todos." },
    ],
  },
  {
    tema: "Mentiras que te cuentas",
    seccion: "sarcasmo",
    parejas: [
      { palabra: "Solo un capítulo más", texto: "Solo un capítulo más, dijiste a la una. Son las cuatro.", remate: "El sueño también es una serie, y la estás dejando para mañana." },
      { palabra: "Mañana madrugo", texto: "Mañana madrugo, prometiste. La alarma ya no te cree.", remate: "Tu alarma tiene más paciencia que tú disciplina." },
      { palabra: "No es para tanto", texto: "No es para tanto, llevas tres años diciéndolo del mismo problema.", remate: "Lo que no es para tanto no dura tanto." },
      { palabra: "Yo controlo", texto: "Yo controlo, dices con el móvil en la mano desde hace dos horas.", remate: "Controlar también es soltar el teléfono." },
      { palabra: "Ya lo hablaremos", texto: "Ya lo hablaremos, y lleva cinco años esperando fecha.", remate: "Lo que no se habla se cobra con intereses." },
      { palabra: "Es la última vez", texto: "Es la última vez. La número cuarenta y dos.", remate: "Las últimas veces también se acumulan." },
      { palabra: "Estoy bien", texto: "Estoy bien, respondes sin levantar la vista.", remate: "Decir que estás bien no te pone bien." },
      { palabra: "Nadie se va a dar cuenta", texto: "Nadie se va a dar cuenta, y tú ya te diste.", remate: "El primero que se entera siempre eres tú." },
    ],
  },
  {
    tema: "Lo que sabes y no quieres oír",
    seccion: "sarcasmo",
    parejas: [
      { palabra: "Tu ex", texto: "Tu ex no va a cambiar. Tú sí podrías.", remate: "Esperar a que otro cambie también es quedarse quieto." },
      { palabra: "Ese grupo de chat", texto: "Ese grupo de chat te quita más paz de la que te da risa.", remate: "Silenciar también es cuidarse." },
      { palabra: "Tu trabajo ideal", texto: "Tu trabajo ideal no va a ir a buscarte al sofá.", remate: "Las oportunidades no tienen tu dirección." },
      { palabra: "La dieta del lunes", texto: "La dieta del lunes empieza cada lunes desde hace un año.", remate: "Los lunes no tienen la culpa de nada." },
      { palabra: "Tu presupuesto", texto: "Tu presupuesto sabe que ese antojo no era una emergencia.", remate: "Lo barato repetido sale carísimo." },
      { palabra: "Discutir en internet", texto: "Discutir en internet no ha convencido nunca a nadie.", remate: "Hay batallas que se ganan cerrando la pestaña." },
      { palabra: "Esa excusa", texto: "Esa excusa suena mejor en tu cabeza que en voz alta.", remate: "Si hay que explicarla tanto, ya sabes lo que es." },
      { palabra: "Lo que postergas", texto: "Lo que postergas no se va: te espera con intereses.", remate: "Pendiente es la palabra más cara del idioma." },
    ],
  },
];

export type RemateBase = { texto: string; tono: string; seccion?: Seccion };

export const REMATES: RemateBase[] = [
  { texto: "Nadie fracasa el primer día. Se fracasa el día que dejas de contarlo.", tono: "reflexiva" },
  { texto: "No te falta tiempo: te sobra la esperanza de tenerlo mañana.", tono: "desmotivadora" },
  { texto: "Casi todo lo que no hiciste, no lo hiciste por descansar cinco minutos.", tono: "desmotivadora" },
  { texto: "Lo raro no es abandonar. Lo raro es volver, y eso también está a tu alcance.", tono: "feliz" },
  { texto: "El día que empiezas nunca es especial. Por eso sirve cualquiera.", tono: "feliz" },
  { texto: "Nadie se acuerda de los años que te costó. Solo de que lo hiciste.", tono: "feliz" },
  { texto: "Se puede vivir entero en la sala de espera de la propia vida.", tono: "triste" },
  { texto: "Lo que no dices se queda contigo, y pesa lo mismo que si lo hubieras dicho mal.", tono: "triste" },
  { texto: "Al final no te arrepientes de lo que hiciste mal, sino de lo que dejaste tibio.", tono: "reflexiva" },
  { texto: "El tiempo no se pierde: se gasta. La diferencia es que gastar se elige.", tono: "reflexiva" },
  { texto: "Ser constante es aburrido. Por eso casi nadie lo es, y por eso funciona.", tono: "reflexiva" },
  { texto: "La vida no te avisa de cuál era el último día de nada.", tono: "triste" },
  { texto: "Nada de lo que estás posponiendo se va a hacer más fácil con los años.", tono: "desmotivadora" },
  { texto: "Cuidado con la vida que estás ensayando: a lo mejor ya es la función.", tono: "reflexiva" },
  { texto: "Todo el mundo está improvisando. Los que parecen seguros solo improvisan más rápido.", tono: "feliz" },
  { texto: "Tus cosas pendientes no te odian. Solo esperan, que es peor.", tono: "desmotivadora" },
  { texto: "Nunca vas a estar listo. Vas a estar viejo, que se parece bastante.", tono: "desmotivadora" },
  { texto: "Hay gente esperando tu mensaje con el teléfono en la mano, esperando el suyo.", tono: "triste" },
  { texto: "Lo que hoy te da vergüenza intentar, mañana es lo que sabes hacer.", tono: "feliz" },
  { texto: "Nadie te va a dar permiso. Ese es el trámite que no existe.", tono: "reflexiva" },
  { texto: "Las cosas importantes nunca son urgentes, y por eso pierden siempre.", tono: "reflexiva" },
  { texto: "Un día haces algo por última vez y no lo sabes. Casi siempre es así.", tono: "triste" },
  { texto: "Puedes cambiar de vida. Lo que no puedes es hacerlo sin que se note.", tono: "feliz" },
  { texto: "Ojalá lo que estás dejando para luego te esté esperando en luego.", tono: "desmotivadora" },
];

/** Cierres sueltos de las dos secciones nuevas, para las parejas que no traen el suyo. */
export const REMATES_NUEVOS: RemateBase[] = [
  { texto: "No tienes que verlo todo claro. Solo el siguiente paso.", tono: "feliz", seccion: "motivacion" },
  { texto: "Lo difícil de hoy es lo que mañana vas a contar riéndote.", tono: "feliz", seccion: "motivacion" },
  { texto: "Nadie te está mirando tanto como crees. Aprovéchalo.", tono: "feliz", seccion: "motivacion" },
  { texto: "Un día cualquiera también puede ser el primero.", tono: "reflexiva", seccion: "motivacion" },
  { texto: "Vas más lejos de lo que te parece desde dentro.", tono: "reflexiva", seccion: "motivacion" },
  { texto: "No hace falta ganas: hace falta ir. Las ganas llegan por el camino.", tono: "reflexiva", seccion: "motivacion" },
  { texto: "Tranquilo, tu yo del futuro seguro que lo arregla. Como siempre.", tono: "desmotivadora", seccion: "sarcasmo" },
  { texto: "Pero bueno, tú sabrás. Siempre sabes.", tono: "desmotivadora", seccion: "sarcasmo" },
  { texto: "Tómatelo con calma. Total, ya llevas años tomándotelo.", tono: "desmotivadora", seccion: "sarcasmo" },
  { texto: "Si te dolió leerlo, era para ti.", tono: "reflexiva", seccion: "sarcasmo" },
  { texto: "No es crítica. Es un espejo con subtítulos.", tono: "reflexiva", seccion: "sarcasmo" },
  { texto: "Lo sabías antes de este vídeo. Solo te faltaba leerlo.", tono: "reflexiva", seccion: "sarcasmo" },
];

export type FilaBase = {
  tipo: "SORTEO" | "REMATE";
  palabra: string;
  texto: string;
  remate: string;
  tema: string;
  tono: string;
  seccion: Seccion;
};

/** Todo junto, como filas listas para el banco, de la sección que se pida. */
export function filasDeBase(seccion?: Seccion): FilaBase[] {
  const familias = [...FAMILIAS, ...FAMILIAS_NUEVAS];
  const remates = [...REMATES, ...REMATES_NUEVOS];
  const filas: FilaBase[] = [
    ...familias.flatMap((f) =>
      f.parejas.map((p) => ({
        tipo: "SORTEO" as const,
        palabra: p.palabra,
        texto: p.texto,
        remate: p.remate ?? "",
        tema: f.tema,
        tono: "reflexiva",
        seccion: f.seccion ?? "triste",
      })),
    ),
    ...remates.map((r) => ({
      tipo: "REMATE" as const,
      palabra: "",
      texto: r.texto,
      remate: "",
      tema: "",
      tono: r.tono,
      seccion: r.seccion ?? "triste",
    })),
  ];
  return seccion ? filas.filter((f) => f.seccion === seccion) : filas;
}
