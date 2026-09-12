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

servidor.registerTool(
  "escribir_guion",
  {
    description:
      "Escribe un guion con gancho sin producir el video. Sirve para revisarlo antes de gastar voz y render.",
    inputSchema: {
      tipo: z.enum(["Reflexion", "Historia"]),
      tema: z.string().max(200).optional(),
      duracion: z.number().int().min(15).max(350).optional(),
      idioma: z.enum(["es", "en"]).optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      modelo: z.string().max(80).optional(),
    },
  },
  async (args) =>
    texto(await llamar("/api/guion", { method: "POST", body: JSON.stringify(args) })),
);

servidor.registerTool(
  "crear_historia",
  {
    description:
      "Encola una historia completa (guion, clips, voz, render). Opcionalmente programa su subida a TikTok.",
    inputSchema: {
      tipo: z.enum(["Reflexion", "Historia"]),
      tema: z.string().max(200).optional(),
      duracion: z.number().int().min(15).max(350).optional(),
      idioma: z.enum(["es", "en"]).optional(),
      motor: z.enum(["groq", "openai", "gemini", "claude"]).optional(),
      modelo: z.string().max(80).optional(),
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
      idioma: z.enum(["es", "en"]).optional(),
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
            idioma: z.enum(["es", "en"]).optional(),
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
