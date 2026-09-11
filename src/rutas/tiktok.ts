import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { db } from "../db.js";
import { env } from "../env.js";
import {
  canjearCodigo,
  guardarTokens,
  tiktokConfigurado,
  accessTokenVigente,
  estadoPublicacion,
} from "../servicios/tiktok.js";

const COOKIE_SEGURA = env.NODE_ENV === "production";

export async function rutasTikTok(app: FastifyInstance) {
  app.get("/api/tiktok/cuentas", async () =>
    db.tikTokCuenta.findMany({
      select: { id: true, openId: true, nombre: true, scopes: true, expiraEn: true },
    }),
  );

  app.delete("/api/tiktok/cuentas/:id", async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    await db.tikTokCuenta.delete({ where: { id } });
    return { ok: true };
  });

  app.get("/api/tiktok/conectar", async (_req, reply) => {
    if (!tiktokConfigurado()) {
      return reply.code(400).send({ error: "Falta configurar las claves de TikTok" });
    }
    const state = randomBytes(24).toString("base64url");
    reply.setCookie("tt_state", state, {
      httpOnly: true,
      secure: COOKIE_SEGURA,
      sameSite: "lax",
      path: "/api/tiktok",
      maxAge: 600,
    });
    const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.search = new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY!,
      response_type: "code",
      scope: env.TIKTOK_SCOPES,
      redirect_uri: env.TIKTOK_REDIRECT_URI!,
      state,
    }).toString();
    return reply.redirect(url.toString());
  });

  // Ruta publica: la protege el parametro state, que evita ataques CSRF
  app.get("/api/tiktok/callback", async (req, reply) => {
    const { code, state } = z
      .object({ code: z.string(), state: z.string() })
      .parse(req.query);
    if (!req.cookies.tt_state || req.cookies.tt_state !== state) {
      return reply.code(400).send("La conexion con TikTok no es valida. Intentalo de nuevo.");
    }
    reply.clearCookie("tt_state", { path: "/api/tiktok" });

    const t = await canjearCodigo(code);
    await guardarTokens(t);
    return reply.redirect("/ajustes?tiktok=conectado");
  });

  app.get("/api/tiktok/estado/:publishId", async (req) => {
    const { publishId } = z.object({ publishId: z.string().min(1).max(200) }).parse(req.params);
    const token = await accessTokenVigente();
    return estadoPublicacion(token, publishId);
  });
}
