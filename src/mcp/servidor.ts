/**
 * Servidor MCP del estudio.
 *
 * Corre por stdio en tu maquina y habla con la API desplegada usando
 * `API_TOKEN`, asi que no abre ningun puerto nuevo en el servidor. Con el,
 * Claude puede consultar el banco, ver que funciono y encargar historias.
 *
 *   ESTUDIO_URL=https://estudio.tudominio.com \
 *   ESTUDIO_TOKEN=...  node dist/mcp/servidor.js
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE = (process.env.ESTUDIO_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.ESTUDIO_TOKEN ?? "";

if (!BASE || !TOKEN) {
  console.error("Faltan ESTUDIO_URL y/o ESTUDIO_TOKEN");
  process.exit(1);
}

async function llamar(ruta: string, init: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${BASE}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(120_000),
  });
  const cuerpo = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle =
      cuerpo && typeof cuerpo === "object" && "error" in cuerpo
        ? String((cuerpo as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new Error(detalle);
  }
  return cuerpo;
}

/** Todas las herramientas devuelven JSON como texto: es lo que MCP transporta. */
const texto = (datos: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(datos, null, 2) }],
});

const servidor = new McpServer({ name: "estudio-voz-en-off", version: "1.0.0" });

const vozSchema = z.object({
  proveedor: z.enum(["gemini", "openai"]),
  modelo: z.string(),
  nombre: z.string(),
});

servidor.registerTool(
  "catalogo",
  {
    description:
      "Motores y modelos disponibles, voces, musica, limites de tamano y estado de TikTok.",
    inputSchema: {},
  },
  async () => texto(await llamar("/api/catalogo")),
);

servidor.registerTool(
  "diagnostico",
  {
    description:
      "Comprueba que cada clave, la base de datos, Redis, ffmpeg y el volumen responden de verdad.",
    inputSchema: {},
  },
  async () => texto(await llamar("/api/diagnostico")),
);

servidor.registerTool(
  "listar_series",
  { description: "Series programadas, con su horario y su modo de publicacion.", inputSchema: {} },
  async () => texto(await llamar("/api/series")),
);

servidor.registerTool(
  "listar_historias",
  {
    description: "Ultimas historias con su estado, titulo, gancho y si ya tienen video.",
    inputSchema: {
      serieId: z.string().uuid().optional(),
      limite: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ serieId, limite }) => {
    const q = new URLSearchParams();
    if (serieId) q.set("serieId", serieId);
    if (limite) q.set("limite", String(limite));
    return texto(await llamar(`/api/historias?${q}`));
  },
);

const categoriaSchema = z
  .string()
  .max(40)
  .describe(
    'Id de categoría (ver listar_categorias), "aleatoria" para sortear una de cualquier área, ' +
      '"aleatoria:ideas" o "aleatoria:ficcion" para sortear dentro de un área, o vacío para tema libre',
  )
  .optional();
const subcategoriaSchema = z.string().max(40).describe("Id de subcategoría; vacío = al azar dentro de la categoría").optional();

const bancosSchema = z
  .array(z.enum(["pexels", "pixabay", "nasa"]))
  .describe("Dónde buscar imagen; vacío = lo que use la categoría (ciencia mira a la NASA)")
  .optional();
const mediosSchema = z
  .array(z.enum(["video", "imagen"]))
  .describe("Vídeo, foto o las dos; las fotos se animan con movimiento en el render")
  .optional();

const miniserieSchema = z
  .object({
    categoria: z.string().max(40),
    subcategoria: z.string().max(40),
    titulo: z.string().max(120),
    sinopsis: z.string().max(900),
    personajes: z.array(z.string().max(120)).max(6).optional(),
    capitulos: z
      .array(
        z.object({
          numero: z.number().int().min(1).max(12),
          titulo: z.string().max(120),
          resumen: z.string().max(600),
          cliffhanger: z.string().max(300).optional(),
        }),
      )
      .min(2)
      .max(12),
    keywords: z.array(z.string().max(40)).min(1).max(8),
    hashtags: z.array(z.string().max(40)).max(8).optional(),
  })
  .describe("Plan devuelto por plantear_miniserie, tal cual");

const premisaSchema = z
  .object({
    categoria: z.string().max(40),
    subcategoria: z.string().max(40),
    titulo: z.string().max(120),
    lineamientos: z.array(z.string().max(200)).min(1).max(8),
    personajes: z.array(z.string().max(120)).max(5).optional(),
    giro: z.string().max(300).optional(),
    fuente: z.string().max(200).optional(),
    idea: z.string().max(400).optional(),
    keywords: z.array(z.string().max(40)).min(1).max(8),
    hashtags: z.array(z.string().max(40)).max(8).optional(),
  })
  .describe("Planteamiento devuelto por plantear_historia, revisado o tal cual");

servidor.registerTool(
  "listar_categorias",
  {
    description:
      "Categorías y subcategorías, en dos áreas: historias de ficción (comedia, drama, terror, real, triunfo, engaño...) " +
      "e ideas (literatura clásica, premios Nobel, filosofía, política y poder, economía, negocios y estafas para reconocerlas).",
    inputSchema: {},
  },
  async () => {
    const c = (await llamar("/api/catalogo")) as {
      categorias: unknown;
      categoriaAleatoria: string;
      areas?: unknown;
    };
    return texto({ categorias: c.categorias, areas: c.areas, aleatoria: c.categoriaAleatoria });
  },
);

servidor.registerTool(
  "plantear_historia",
  {
    description:
      "Antes de escribir: elige categoría y subcategoría (al azar si no se fijan) y genera título, lineamientos, giro y criterios de búsqueda de clips. En el área de ideas devuelve además la fuente (obra, autor o corriente) y la idea central. El resultado se revisa y se pasa como `premisa` a escribir_guion o crear_historia.",
    inputSchema: {
      categoria: categoriaSchema,
      subcategoria: subcategoriaSchema,
      tema: z.string().max(200).optional(),
      duracion: z.number().int().min(15).max(900).optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
      region: z.enum(["bolivia", "latam", "eeuu"]).optional(),
      modismos: z.boolean().optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      modelo: z.string().max(80).optional(),
    },
  },
  async (args) =>
    texto(await llamar("/api/premisa", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "escribir_guion",
  {
    description:
      "Escribe un guion con gancho sin producir el video. Sirve para revisarlo antes de gastar voz y render. Con categoría (o 'aleatoria') plantea primero título y lineamientos.",
    inputSchema: {
      tipo: z.enum(["Reflexion", "Historia"]),
      tema: z.string().max(200).optional(),
      categoria: categoriaSchema,
      subcategoria: subcategoriaSchema,
      premisa: premisaSchema.optional(),
      miniserie: miniserieSchema.optional(),
      capitulo: z.number().int().min(1).max(12).describe("Qué capítulo de la miniserie escribir").optional(),
      duracion: z.number().int().min(15).max(900).optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
      region: z.enum(["bolivia", "latam", "eeuu"]).optional(),
      modismos: z.boolean().optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      modelo: z.string().max(80).optional(),
    },
  },
  async (args) =>
    texto(await llamar("/api/guion", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "plantear_miniserie",
  {
    description:
      "Planea una miniserie entera: título, sinopsis, personajes y qué pasa en cada capítulo con su corte final. Después, cada capítulo se escribe pasando `miniserie` y `capitulo` a escribir_guion o crear_historia. Para capítulos largos usa el formato vertical_largo o youtube_largo (hasta 900 s).",
    inputSchema: {
      categoria: categoriaSchema,
      subcategoria: subcategoriaSchema,
      tema: z.string().max(200).optional(),
      capitulos: z.number().int().min(2).max(12).describe("Cuántos capítulos (4 por defecto)").optional(),
      duracion: z.number().int().min(15).max(900).describe("Segundos por capítulo").optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
      region: z.enum(["bolivia", "latam", "eeuu"]).optional(),
      modismos: z.boolean().optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      modelo: z.string().max(80).optional(),
    },
  },
  async (args) =>
    texto(await llamar("/api/miniserie", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "crear_historia",
  {
    description:
      "Encola una historia completa (guion, clips, voz, render). Opcionalmente programa su subida a TikTok.",
    inputSchema: {
      tipo: z.enum(["Reflexion", "Historia"]),
      tema: z.string().max(200).optional(),
      categoria: categoriaSchema,
      subcategoria: subcategoriaSchema,
      premisa: premisaSchema.optional(),
      duracion: z.number().int().min(15).max(900).optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
      region: z.enum(["bolivia", "latam", "eeuu"]).optional(),
      modismos: z.boolean().optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      modelo: z.string().max(80).optional(),
      miniserie: miniserieSchema.optional(),
      capitulo: z.number().int().min(1).max(12).describe("Qué capítulo de la miniserie producir").optional(),
      bancos: bancosSchema,
      medios: mediosSchema,
      voz: vozSchema,
      musica: z.string().max(120).nullable().optional(),
      modoPublicacion: z.enum(["DESCARGA", "BORRADOR_TIKTOK", "DIRECTO_TIKTOK"]).optional(),
      publicarEn: z
        .string()
        .describe("Fecha ISO con zona horaria para programar la subida")
        .optional(),
    },
  },
  async (args) =>
    texto(await llamar("/api/historias", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "programar_subida",
  {
    description: "Sube una historia ya renderizada a TikTok, ahora o en la fecha indicada.",
    inputSchema: {
      historiaId: z.string().uuid(),
      publicarEn: z.string().describe("Fecha ISO con zona horaria; vacio = ahora").optional(),
    },
  },
  async ({ historiaId, publicarEn }) =>
    texto(
      await llamar(`/api/historias/${historiaId}/publicar`, {
        method: "POST",
        body: JSON.stringify({ publicarEn: publicarEn ?? null }),
      }),
    ),
);

servidor.registerTool(
  "listar_ideas",
  {
    description: "Banco de historias: ideas pendientes, usadas o descartadas, con su puntuacion.",
    inputSchema: {
      estado: z.enum(["PENDIENTE", "USADA", "DESCARTADA"]).optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
    },
  },
  async ({ estado, idioma }) => {
    const q = new URLSearchParams();
    if (estado) q.set("estado", estado);
    if (idioma) q.set("idioma", idioma);
    return texto(await llamar(`/api/ideas?${q}`));
  },
);

servidor.registerTool(
  "agregar_ideas",
  {
    description: "Anade ideas al banco para que el programador las use en proximas historias.",
    inputSchema: {
      ideas: z
        .array(
          z.object({
            titulo: z.string().min(3).max(200),
            tema: z.string().min(3).max(200),
            idioma: z.enum(["es", "en", "spanglish"]).optional(),
            notas: z.string().max(500).optional(),
          }),
        )
        .min(1)
        .max(50),
    },
  },
  async ({ ideas }) =>
    texto(await llamar("/api/ideas", { method: "POST", body: JSON.stringify(ideas) })),
);

servidor.registerTool(
  "importar_musica_suno",
  {
    description:
      "Añade a la biblioteca de música una canción de Suno a partir de su enlace (https://suno.com/song/...). Queda disponible para series, historias y el editor, y sus créditos se añaden solos.",
    inputSchema: { url: z.string().url() },
  },
  async ({ url }) =>
    texto(await llamar("/api/musica/enlace", { method: "POST", body: JSON.stringify({ url }) })),
);

servidor.registerTool(
  "crear_videoclip",
  {
    description:
      "Monta un videoclip musical: la cancion (enlace de Suno o pista de la biblioteca) manda la duracion y la letra decide que se ve en cada tramo. Si es instrumental, los lineamientos hacen de guion visual. Devuelve el proyecto; el montaje sigue en segundo plano.",
    inputSchema: {
      nombre: z.string().max(120).optional(),
      formato: z.string().max(40).describe("tiktok, youtube, cuadrado, instagram_feed o facebook").optional(),
      enlaceSuno: z.string().url().describe("https://suno.com/song/...").optional(),
      musica: z.string().max(200).describe("Nombre de una pista ya presente en la biblioteca").optional(),
      canciones: z
        .array(
          z.object({
            tipo: z.enum(["suno", "biblioteca"]),
            valor: z.string().max(400),
            titulo: z.string().max(120).optional(),
            letra: z.string().max(20_000).optional(),
          }),
        )
        .max(8)
        .describe("Varias canciones encadenadas, para un videoclip mas largo")
        .optional(),
      cruce: z.number().min(0).max(10).optional(),
      letra: z.string().max(20_000).describe("La letra tal cual, con sus etiquetas [Verso], [Coro]...").optional(),
      lineamientos: z.string().max(2000).describe("Que se debe ver; obligatorio en instrumentales").optional(),
      instrumental: z.boolean().optional(),
      mostrarLetra: z.boolean().describe("Quemar la letra sobre el video (por defecto si)").optional(),
    },
  },
  async (args) =>
    texto(await llamar("/api/proyectos/musical", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "sugerir_lineamientos",
  {
    description:
      "Ayuda para describir un videoclip: a partir de la letra (o del titulo) propone el ambiente, las palabras de busqueda de clips EN INGLES y un prompt largo para generar imagenes con IA. No guarda nada.",
    inputSchema: {
      titulo: z.string().max(120).optional(),
      letra: z.string().max(20_000).optional(),
      lineamientos: z.string().max(2000).describe("Lo poco que ya haya escrito el autor").optional(),
      instrumental: z.boolean().optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
    },
  },
  async (args) =>
    texto(await llamar("/api/lineamientos", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "unir_canciones",
  {
    description:
      "Encadena varias canciones (enlaces de Suno o pistas de la biblioteca) en una sola pista para alargar un videoclip, y vuelve a montar la imagen. Cada cancion puede traer su propia letra: asi cada tema reparte sus propios tramos.",
    inputSchema: {
      proyectoId: z.string().uuid(),
      fuentes: z
        .array(
          z.object({
            tipo: z.enum(["suno", "biblioteca", "proyecto"]),
            valor: z.string().max(400).describe("Enlace de Suno, o nombre de la pista"),
            titulo: z.string().max(120).optional(),
            letra: z.string().max(20_000).optional(),
          }),
        )
        .min(1)
        .max(8),
      cruce: z.number().min(0).max(10).describe("Segundos de solape entre canciones; 0 = corte seco").optional(),
    },
  },
  async ({ proyectoId, fuentes, cruce }) =>
    texto(
      await llamar(`/api/proyectos/${proyectoId}/canciones`, {
        method: "POST",
        body: JSON.stringify({ fuentes, cruce }),
      }),
    ),
);

servidor.registerTool(
  "sad_but_true",
  {
    description:
      "Escribe un 'Sad but true' (o de motivacion, o de sarcasmo): la familia entera de palabras, cada una con su frase y su cierre, y cual gana. Se guarda sola en el banco, asi que ese tema ya se puede volver a sortear sin IA. No monta nada.",
    inputSchema: {
      seccion: z
        .enum(["triste", "motivacion", "sarcasmo"])
        .describe("triste = sad but true (lo de siempre), motivacion o sarcasmo. La Biblia va por biblia_siguiente")
        .optional(),
      tema: z.string().max(300).describe("De que va el sorteo; vacio = lo elige la IA").optional(),
      tono: z
        .enum(["feliz", "triste", "reflexiva", "desmotivadora"])
        .describe("Humor del remate; vacio = el que le pegue a la frase")
        .optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
    },
  },
  async (args) => texto(await llamar("/api/sadbuttrue", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "montar_sad_but_true",
  {
    description:
      "Monta el video de un 'Sad but true' con el guion (el de sad_but_true, o uno corregido): negro con el sorteo, un video al azar con la frase y el negro final con el remate. Devuelve el proyecto listo para renderizar.",
    inputSchema: {
      guion: z
        .object({
          titulo: z.string().max(120),
          palabras: z.array(z.string().max(40)).min(4).max(14),
          elegida: z.string().max(40).describe("Tiene que ser una de las de palabras"),
          frase: z.string().max(300),
          remate: z.string().max(300),
          tono: z.enum(["feliz", "triste", "reflexiva", "desmotivadora", "aliento", "historico"]).optional(),
          keywords: z.array(z.string().max(40)).min(1).max(6).describe("EN INGLES: con esto se busca el video"),
          hashtags: z.array(z.string().max(40)).max(8).optional(),
          seccion: z.enum(["triste", "motivacion", "sarcasmo", "biblia", "pensadores"]).optional(),
          citaId: z
            .string()
            .uuid()
            .describe("Grandes pensadores: la cita guardada de la que sale (la da pensadores_buscar). Cita, autor y obra los pone el servidor")
            .optional(),
          referenciaId: z
            .string()
            .uuid()
            .describe("Aprendiendo con la Biblia: la referencia de la que sale (la da biblia_siguiente). La cita la pone el servidor")
            .optional(),
          intro: z
            .object({ titulo: z.string().max(80), subtitulo: z.string().max(80).optional() })
            .describe("Titulo del principio, sobre negro (en la Biblia: 'Aprendiendo con la Biblia' y el libro)")
            .optional(),
        })
        .describe("El guion entero"),
      formato: z.string().max(40).optional(),
      bancos: z.array(z.string().max(20)).max(3).describe("aleatorio, pexels, nasa...").optional(),
      revelarFrase: z.boolean().describe("La frase se escribe palabra a palabra").optional(),
      tiempos: z
        .object({
          sorteoSeg: z.number().min(0.8).max(8),
          retencionSeg: z.number().min(0.3).max(4),
          clipSeg: z.number().min(2).max(15),
          cierreSeg: z.number().min(1).max(10),
        })
        .describe("Los de fabrica son 2 / 1 / 5 / 3")
        .optional(),
    },
  },
  async (args) => texto(await llamar("/api/sadbuttrue/video", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "sortear_sad_but_true",
  {
    description:
      "Saca un 'Sad but true' del banco de frases, sin gastar IA: una pareja de las menos usadas, su bombo del mismo tema y un remate, todo de la misma seccion. Devuelve el guion listo para montar_sad_but_true. Para la Biblia, biblia_siguiente.",
    inputSchema: {
      seccion: z
        .enum(["triste", "motivacion", "sarcasmo"])
        .describe("triste = sad but true (lo de siempre), motivacion o sarcasmo. La Biblia va por biblia_siguiente")
        .optional(),
      tema: z.string().max(80).describe("Familia de palabras; vacio = cualquiera").optional(),
      tono: z.enum(["feliz", "triste", "reflexiva", "desmotivadora", "aliento", "historico"]).optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
    },
  },
  async (args) => texto(await llamar("/api/sadbuttrue/azar", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "biblia_referencias",
  {
    description:
      "Aprendiendo con la Biblia: las referencias guardadas, de Genesis a Apocalipsis, con su cita comprobada contra la Reina-Valera 1909, el texto literal, lo curioso (dato), lo escrito (palabra, frase, cierre) y su estado: pendiente (falta completar), revisar (algo no cuadra) o lista. Dice tambien cual es la siguiente de la serie.",
    inputSchema: {
      rango: z.enum(["todo", "AT", "NT"]).describe("Toda la Biblia, Antiguo o Nuevo Testamento").optional(),
      libro: z.number().int().min(1).max(66).describe("1 = Genesis ... 66 = Apocalipsis").optional(),
      tema: z.string().max(80).describe("Solo las de un tema (la lista sale en la respuesta, en 'temas')").optional(),
      estado: z.enum(["pendiente", "revisar", "lista"]).optional(),
      q: z.string().max(80).describe("Buscar en cita, tema, dato o texto").optional(),
    },
  },
  async (args) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v) q.set(k, String(v));
    return texto(await llamar(`/api/biblia/referencias?${q}`));
  },
);

servidor.registerTool(
  "biblia_cita",
  {
    description: "El texto literal de una cita en la Reina-Valera 1909 (p. ej. 'Levitico 11:10', 'Jueces 11:30-34'), o el aviso de que no existe.",
    inputSchema: { cita: z.string().min(2).max(80) },
  },
  async ({ cita }) => texto(await llamar(`/api/biblia/cita?q=${encodeURIComponent(cita)}`)),
);

servidor.registerTool(
  "biblia_guardar_referencia",
  {
    description:
      "Guarda una referencia nueva de Aprendiendo con la Biblia, o corrige una (con id). La cita se comprueba contra la Reina-Valera 1909: si no existe, no se guarda. La frase va SIN cita (la pone la app) y tiene que empezar por la palabra; el cierre es de aliento o historico y sus citas tambien se comprueban.",
    inputSchema: {
      id: z.string().uuid().describe("Para corregir una que ya existe").optional(),
      cita: z.string().max(60).describe("Libro capitulo:versiculo, p. ej. 'Levitico 19:27'").optional(),
      tema: z.string().max(80).optional(),
      dato: z.string().max(400).describe("Lo curioso, en una linea").optional(),
      palabra: z.string().max(40).describe("De 1 a 3 palabras: lo que se sortea; la frase empieza por aqui").optional(),
      frase: z.string().max(300).optional(),
      remate: z.string().max(300).optional(),
      tono: z.enum(["aliento", "historico"]).optional(),
    },
  },
  async ({ id, ...cambios }) =>
    texto(
      await llamar(id ? `/api/biblia/referencias/${id}` : "/api/biblia/referencias", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(cambios),
      }),
    ),
);

servidor.registerTool(
  "biblia_completar",
  {
    description:
      "Completa con IA las referencias pendientes de Aprendiendo con la Biblia, en orden (o las que se pasen por id): palabra del sorteo, frase y cierre. La IA lee el versiculo literal de cada una; lo que no cuadre queda 'para revisar' y no sale en la serie.",
    inputSchema: {
      ids: z.array(z.string().uuid()).max(10).optional(),
      cuantas: z.number().int().min(1).max(10).optional(),
      rango: z.enum(["todo", "AT", "NT"]).optional(),
      tono: z.enum(["aliento", "historico"]).optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      rehacer: z.boolean().describe("Reescribir tambien las que ya estan completas").optional(),
    },
  },
  async (args) => texto(await llamar("/api/biblia/referencias/completar", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "biblia_proponer",
  {
    description:
      "Busca con IA mas datos curiosos en un libro de la Biblia, en un tema o en los dos. Solo se guardan los que pasan la comprobacion: la cita existe en la Reina-Valera 1909 y su texto contiene las palabras clave que propuso la IA. Devuelve las guardadas y las descartadas con el motivo.",
    inputSchema: {
      libro: z.number().int().min(1).max(66).describe("1 = Genesis ... 66 = Apocalipsis; sin libro, toda la Biblia").optional(),
      tema: z.string().max(80).describe("Uno de los temas de la serie").optional(),
      cuantas: z.number().int().min(1).max(15).optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
    },
  },
  async (args) => texto(await llamar("/api/biblia/proponer", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "biblia_siguiente",
  {
    description:
      "El guion del siguiente video de Aprendiendo con la Biblia: la primera referencia lista que aun no salio, en orden de Genesis a Apocalipsis (o una concreta con referenciaId, o una al azar). Abre con el titulo de la serie y el libro; la frase lleva su cita exacta. Se pasa tal cual a montar_sad_but_true.",
    inputSchema: {
      referenciaId: z.string().uuid().optional(),
      modo: z.enum(["siguiente", "azar"]).optional(),
      rango: z.enum(["todo", "AT", "NT"]).optional(),
      tema: z.string().max(80).describe("La siguiente de un tema").optional(),
      titulo: z.string().max(80).describe("Titulo de la serie; por defecto 'Aprendiendo con la Biblia'").optional(),
    },
  },
  async (args) => texto(await llamar("/api/biblia/guion", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "pensadores_buscar",
  {
    description:
      "Grandes pensadores: de una semilla (un tema o una frase que urge, p. ej. 'la prisa' o 'siempre empiezo el lunes') al guion del video: sorteo de nombres de pensadores, el elegido con su cita y su obra, y un cierre para hoy. modo 'banco' busca en las citas guardadas sin IA; modo 'ia' le pide a la IA un pensador por epoca, y lo guarda todo en el banco 'por comprobar'. Devuelve el guion (va tal cual a montar_sad_but_true) y los demas encontrados.",
    inputSchema: {
      semilla: z.string().max(200),
      modo: z.enum(["banco", "ia"]).optional(),
      soloComprobadas: z.boolean().describe("En modo banco, solo citas comprobadas (por defecto si)").optional(),
      cierre: z.enum(["aplicacion", "otra_cita"]).describe("aplicacion = lo que dice hoy; otra_cita = otra cita del mismo autor").optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      titulo: z.string().max(80).describe("Por defecto 'Grandes pensadores'").optional(),
    },
  },
  async (args) => texto(await llamar("/api/pensadores/buscar", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "pensadores_citas",
  {
    description:
      "El banco de Grandes pensadores: citas con autor, obra, lugar exacto, temas, contexto y si estan comprobadas. Con q busca por tema o semilla.",
    inputSchema: {
      autor: z.string().max(60).optional(),
      q: z.string().max(200).optional(),
      verificada: z.enum(["si", "no"]).optional(),
    },
  },
  async (args) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v) q.set(k, String(v));
    return texto(await llamar(`/api/pensadores/citas?${q}`));
  },
);

servidor.registerTool(
  "pensadores_guardar_cita",
  {
    description:
      "Guarda una cita nueva en Grandes pensadores, o corrige una (con id); verificada=true cuando se ha comprobado la fuente.",
    inputSchema: {
      id: z.string().uuid().optional(),
      autor: z.string().max(40).optional(),
      obra: z.string().max(120).optional(),
      ubicacion: z.string().max(60).optional(),
      texto: z.string().max(400).optional(),
      temas: z.array(z.string().max(40)).max(10).optional(),
      contexto: z.string().max(400).optional(),
      remate: z.string().max(200).optional(),
      visual: z.array(z.string().max(40)).max(6).optional(),
      verificada: z.boolean().optional(),
    },
  },
  async ({ id, ...cambios }) =>
    texto(
      await llamar(id ? `/api/pensadores/citas/${id}` : "/api/pensadores/citas", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(cambios),
      }),
    ),
);

servidor.registerTool(
  "banco_frases",
  {
    description:
      "Lo que hay en el banco de 'Sad but true': parejas palabra/frase, remates y de que temas, por seccion. De aqui salen los sorteos sin IA.",
    inputSchema: {
      seccion: z
        .enum(["triste", "motivacion", "sarcasmo"])
        .describe("triste = sad but true (lo de siempre), motivacion o sarcasmo. La Biblia va por biblia_siguiente")
        .optional(),
      tipo: z.enum(["SORTEO", "REMATE"]).optional(),
      tema: z.string().max(80).optional(),
      buscar: z.string().max(80).optional(),
    },
  },
  async (args) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(args)) if (v) q.set(k, String(v));
    return texto(await llamar(`/api/frases?${q}`));
  },
);

servidor.registerTool(
  "guardar_frases",
  {
    description:
      "Mete frases en el banco de 'Sad but true'. Una por linea, con ; entre campos. Con formato 'palabra': 'palabra ; frase ; remate'. Con formato 'frase': 'frase ; remate ; sobre X', que es como salen las sentencias en dos tiempos. En los dos, una linea sin ningun ; es un remate suelto. Con guardar=false solo dice que ha entendido de cada linea.",
    inputSchema: {
      seccion: z
        .enum(["triste", "motivacion", "sarcasmo"])
        .describe("triste = sad but true (lo de siempre), motivacion o sarcasmo. La Biblia va por biblia_siguiente")
        .optional(),
      texto: z.string().max(40_000).describe("Las lineas, separadas por saltos de linea"),
      formato: z
        .enum(["palabra", "frase"])
        .describe("Donde va la palabra del bombo: delante, o al final como 'sobre X'")
        .optional(),
      tema: z.string().max(80).describe("La familia a la que pertenecen estas palabras").optional(),
      idioma: z.enum(["es", "en", "spanglish"]).optional(),
      tono: z.enum(["feliz", "triste", "reflexiva", "desmotivadora", "aliento", "historico"]).optional(),
      guardar: z.boolean().describe("false = solo vista previa").optional(),
    },
  },
  async (args) => texto(await llamar("/api/frases/pegar", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "momentos_cancion",
  {
    description:
      "Los tramos con mas fuerza de la cancion de un videoclip, para saber por donde cortar los 30 segundos que van a redes.",
    inputSchema: {
      proyectoId: z.string().uuid(),
      ventana: z.number().int().min(5).max(120).describe("Segundos que dura el corte").optional(),
      cuantos: z.number().int().min(1).max(5).optional(),
    },
  },
  async ({ proyectoId, ventana, cuantos }) => {
    const q = new URLSearchParams();
    if (ventana) q.set("ventana", String(ventana));
    if (cuantos) q.set("cuantos", String(cuantos));
    return texto(await llamar(`/api/proyectos/${proyectoId}/momentos?${q}`));
  },
);

servidor.registerTool(
  "crear_cortes",
  {
    description:
      "Saca del mismo montaje varias salidas: la version completa en un formato y cortes de X segundos en otros. Cada una se renderiza y se descarga aparte.",
    inputSchema: {
      proyectoId: z.string().uuid(),
      variantes: z
        .array(
          z.object({
            nombre: z.string().max(80),
            formato: z.string().max(40).describe("tiktok, youtube, cuadrado, instagram_feed o facebook"),
            inicio: z.number().min(0).describe("Segundo del montaje por el que empieza").optional(),
            duracion: z.number().min(1).describe("Segundos; vacio = hasta el final").nullable().optional(),
          }),
        )
        .min(1)
        .max(8),
    },
  },
  async ({ proyectoId, variantes }) =>
    texto(
      await llamar(`/api/proyectos/${proyectoId}/variantes`, {
        method: "POST",
        body: JSON.stringify({ variantes }),
      }),
    ),
);

servidor.registerTool(
  "rendimiento",
  {
    description:
      "Que esta funcionando: mejores ganchos, mejores ideas y las metricas mas recientes.",
    inputSchema: {},
  },
  async () => texto(await llamar("/api/rendimiento")),
);

servidor.registerTool(
  "sincronizar_metricas",
  {
    description: "Pide a TikTok las metricas de las historias publicadas por API.",
    inputSchema: {},
  },
  async () => texto(await llamar("/api/metricas/sincronizar", { method: "POST" })),
);

await servidor.connect(new StdioServerTransport());
