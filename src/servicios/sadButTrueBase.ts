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

export type ParejaBase = { palabra: string; texto: string };
export type FamiliaBase = { tema: string; parejas: ParejaBase[] };

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

export type RemateBase = { texto: string; tono: string };

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

/** Todo junto, como filas listas para el banco. */
export function filasDeBase(): {
  tipo: "SORTEO" | "REMATE";
  palabra: string;
  texto: string;
  tema: string;
  tono: string;
}[] {
  return [
    ...FAMILIAS.flatMap((f) =>
      f.parejas.map((p) => ({
        tipo: "SORTEO" as const,
        palabra: p.palabra,
        texto: p.texto,
        tema: f.tema,
        tono: "reflexiva",
      })),
    ),
    ...REMATES.map((r) => ({ tipo: "REMATE" as const, palabra: "", texto: r.texto, tema: "", tono: r.tono })),
  ];
}
