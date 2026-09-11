import { existsSync } from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import { ZodError } from "zod";
import { env } from "./env.js";
import { db } from "./db.js";
import { prepararCarpetas } from "./almacen.js";
import { registrarAuth, asegurarAdminMaestro } from "./seguridad/auth.js";
import { registrarRutas } from "./rutas/index.js";
import { iniciarWorker, programarSerie, detenerWorker } from "./cola/cola.js";
import { cerrarRedisClips } from "./servicios/clips.js";

const app = Fastify({
  trustProxy: true, // detras del proxy de Easypanel: IP real y HTTPS correctos
  bodyLimit: 1_000_000, // 1 MB; la app no recibe archivos del usuario
  logger: { redact: ["req.headers.authorization", "req.headers.cookie"] },
});

await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      "default-src": ["'self'"],
      "img-src": ["'self'", "data:", "https://images.pexels.com", "https://cdn.pixabay.com"],
      "media-src": ["'self'", "blob:"],
      "connect-src": ["'self'"],
    },
  },
});
await app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
await app.register(cookie);
await registrarAuth(app);
await registrarRutas(app);

type ErrorHTTP = Error & { statusCode?: number; code?: string };

app.setErrorHandler((error: ErrorHTTP, req, reply) => {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "Datos invalidos",
      detalle: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    });
  }
  // Prisma: registro no encontrado
  if (error.code === "P2025") {
    return reply.code(404).send({ error: "No encontrado" });
  }
  req.log.error(error);
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  return reply.code(status).send({
    error: status >= 500 ? "Error interno" : error.message,
  });
});

const web = path.resolve("web/dist");
if (existsSync(web)) {
  await app.register(fastifyStatic, { root: web });
}
app.setNotFoundHandler((req, reply) =>
  req.url.startsWith("/api/") || !existsSync(web)
    ? reply.code(404).send({ error: "No encontrado" })
    : reply.sendFile("index.html"),
);

await prepararCarpetas();
await asegurarAdminMaestro((m) => app.log.info(m));
await iniciarWorker();

// Vuelve a registrar los horarios por si Redis se vacio entre despliegues
for (const serie of await db.serie.findMany({ where: { activa: true } })) {
  await programarSerie(serie);
}

await app.listen({ port: env.PORT, host: "0.0.0.0" });

for (const senal of ["SIGINT", "SIGTERM"] as const) {
  process.once(senal, async () => {
    app.log.info(`${senal} recibida, cerrando`);
    await app.close();
    await detenerWorker();
    await cerrarRedisClips().catch(() => {});
    await db.$disconnect();
    process.exit(0);
  });
}
