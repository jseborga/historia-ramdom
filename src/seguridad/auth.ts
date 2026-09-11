import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");

/** Rutas /api que no exigen sesion: el login y el retorno de OAuth de TikTok. */
const RUTAS_PUBLICAS = new Set(["/api/login", "/api/tiktok/callback", "/api/salud"]);
const DIAS_SESION = 7;

/** En desarrollo la app corre sobre http, donde una cookie `secure` nunca llega. */
const COOKIE_SEGURA = env.NODE_ENV === "production";

export async function registrarAuth(app: FastifyInstance) {
  app.post(
    "/api/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    async (req, reply) => {
      const { email, password } = z
        .object({
          email: z.string().email(),
          password: z.string().min(12).max(200),
        })
        .parse(req.body);

      const user = await db.user.findUnique({ where: { email } });
      const valido = user ? await argon2.verify(user.passwordHash, password) : false;
      if (!user || !valido) {
        return reply.code(401).send({ error: "Correo o contrasena incorrectos" });
      }

      const token = randomBytes(32).toString("base64url");
      await db.session.create({
        data: {
          userId: user.id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + DIAS_SESION * 864e5),
        },
      });
      reply.setCookie("sid", token, {
        httpOnly: true,
        secure: COOKIE_SEGURA,
        sameSite: "strict",
        path: "/",
        maxAge: DIAS_SESION * 86400,
      });
      return { ok: true, email: user.email };
    },
  );

  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies.sid;
    if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });

  /** Permite al frontend saber si la cookie sigue siendo valida. */
  app.get("/api/yo", async (req) => {
    const token = req.cookies.sid;
    const sesion = token
      ? await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } })
      : null;
    return { email: sesion?.user.email ?? null };
  });

  // Protege todas las rutas /api excepto las publicas
  app.addHook("onRequest", async (req, reply) => {
    const ruta = req.routeOptions.url ?? req.url;
    if (!req.url.startsWith("/api/") || RUTAS_PUBLICAS.has(ruta)) return;
    const token = req.cookies.sid;
    const sesion = token
      ? await db.session.findUnique({ where: { tokenHash: sha256(token) } })
      : null;
    if (!sesion || sesion.expiresAt < new Date()) {
      if (sesion) await db.session.delete({ where: { id: sesion.id } }).catch(() => {});
      return reply.code(401).send({ error: "Inicia sesion para continuar" });
    }
  });
}

/**
 * Crea o actualiza el administrador maestro a partir del entorno.
 * Se prefiere ADMIN_PASSWORD_HASH: asi la contrasena en claro nunca vive en el
 * panel del servidor. ADMIN_PASSWORD existe para el primer arranque rapido.
 */
export async function asegurarAdminMaestro(log: (m: string) => void = () => {}) {
  const email = env.ADMIN_EMAIL;
  if (!email) return null;

  const hash =
    env.ADMIN_PASSWORD_HASH ??
    (env.ADMIN_PASSWORD
      ? await argon2.hash(env.ADMIN_PASSWORD, { type: argon2.argon2id })
      : null);

  if (!hash) {
    log("ADMIN_EMAIL esta puesto pero faltan ADMIN_PASSWORD_HASH o ADMIN_PASSWORD");
    return null;
  }

  const existente = await db.user.findUnique({ where: { email } });
  // Solo se reescribe el hash si cambio, para no invalidar nada en cada arranque.
  if (existente?.passwordHash === hash && existente.maestro) return existente;

  const user = await db.user.upsert({
    where: { email },
    create: { email, passwordHash: hash, maestro: true },
    update: { passwordHash: hash, maestro: true },
  });
  log(`Administrador maestro listo (${email})`);
  return user;
}

/** La ejecuta la limpieza diaria para no acumular sesiones caducadas. */
export async function borrarSesionesCaducadas() {
  const { count } = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
