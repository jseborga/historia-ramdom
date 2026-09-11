# Estudio de voz en off: guía para construirlo y desplegarlo con seguridad en Easypanel

Esta guía convierte el prototipo en una aplicación real que corre en tu servidor. La app escribe el guion, busca clips libres, genera la voz y renderiza un MP4 vertical con subtítulos que puedes descargar. Además, un programador crea historias de forma automática y, si lo configuras, las envía a TikTok.

Los fragmentos de código son un esqueleto funcional en Node.js y TypeScript. Adáptalos, pruébalos primero en local y revisa los nombres de modelos y endpoints antes de desplegar, porque los proveedores los cambian con frecuencia.

---

## 0. Qué es posible y qué no

Antes de construir conviene tener claras cuatro respuestas:

| Pregunta | Respuesta corta |
|---|---|
| ¿Descargar el MP4 con audio, video y subtítulos? | Sí. Se renderiza con ffmpeg en tu servidor. |
| ¿Programar historias automáticas? | Sí. Una cola con Redis (BullMQ) ejecuta cada serie según un horario. |
| ¿Conectar con CapCut para subir a TikTok? | No de forma automática. CapCut no ofrece una API pública para editar o publicar desde tu servidor; su vinculación con TikTok solo funciona dentro de la app móvil de CapCut. |
| ¿Subir directo a TikTok desde la app? | Técnicamente sí, con la Content Posting API, pero con restricciones fuertes (ver sección 9). |

**Sobre TikTok, lo importante:**

- Mientras tu app no pase la auditoría de TikTok, todo lo que publique queda en modo privado, solo 5 usuarios pueden publicar en 24 horas y sus cuentas deben ser privadas.
- Las guías de TikTok rechazan expresamente las herramientas pensadas solo para subir contenido a las cuentas que tú o tu equipo gestionan. Una app de uso personal difícilmente pasará la auditoría para publicación pública.
- La ruta más realista es **descargar el MP4 y programarlo en TikTok Studio desde el navegador**, que permite agendar hasta 10 días antes con una cuenta Creator o Business.
- La alternativa intermedia es enviar el video a los **borradores** de TikTok por API: te llega una notificación y terminas la publicación en la app.
- No uses bots de navegador ni métodos no oficiales para publicar: incumplen los términos de TikTok y ponen en riesgo tu cuenta.

---

## 1. Arquitectura

```
                    Internet (HTTPS)
                          │
                ┌─────────▼─────────┐
                │ Proxy de Easypanel │  certificados automáticos
                └─────────┬─────────┘
                          │ puerto 3000 (red interna)
          ┌───────────────▼────────────────┐
          │  App "estudio" (un contenedor) │
          │  • API Fastify + frontend React │
          │  • Worker BullMQ + ffmpeg       │
          │  • Volumen /data (videos)       │
          └───────┬───────────────┬────────┘
                  │               │
          ┌───────▼──────┐ ┌──────▼──────┐
          │  Postgres    │ │   Redis     │   solo red interna,
          │ (Easypanel)  │ │ (Easypanel) │   sin puertos públicos
          └──────────────┘ └─────────────┘

  Servicios externos (solo desde el servidor, nunca desde el navegador):
  Anthropic · Gemini · OpenAI · Groq · Pexels · Pixabay · TikTok
```

**Por qué un solo contenedor para API y worker:** así los dos comparten el mismo volumen `/data` sin configuraciones extra. Para uso personal o de un equipo pequeño es suficiente. Si más adelante el render satura la CPU, separa el worker en otro servicio y guarda los videos en un almacenamiento compatible con S3 (MinIO, Cloudflare R2).

**Principio central de seguridad:** el navegador solo habla con tu API. Todas las claves (IA, voz, clips, TikTok) viven en variables de entorno del servidor y nunca llegan al frontend.

---

## 2. Estructura del proyecto

```
estudio/
├── Dockerfile
├── .dockerignore
├── package.json
├── tsconfig.json
├── prisma/
│   └── schema.prisma
├── fonts/                      # fuentes con licencia libre para subtítulos
├── web/                        # frontend (el prototipo, adaptado)
│   └── src/...
└── src/
    ├── index.ts                # arranca API y worker
    ├── env.ts                  # valida variables de entorno
    ├── db.ts                   # cliente Prisma
    ├── seguridad/
    │   ├── cifrado.ts          # AES-256-GCM para tokens
    │   └── auth.ts             # login, sesiones, protección de rutas
    ├── servicios/
    │   ├── guion.ts            # Claude, Gemini, OpenAI, Groq
    │   ├── voz.ts              # Gemini TTS, OpenAI TTS
    │   ├── clips.ts            # Pexels, Pixabay, descarga segura
    │   └── tiktok.ts           # OAuth, borradores, publicación directa
    ├── render/
    │   ├── ffmpeg.ts           # ejecución segura de ffmpeg
    │   ├── subtitulos.ts       # genera el archivo .ass
    │   └── render.ts           # pipeline completo
    ├── cola/
    │   ├── cola.ts             # colas y programador
    │   └── trabajos.ts         # crear historia, publicar, limpiar
    ├── rutas/                  # endpoints HTTP
    └── scripts/
        └── crear-admin.ts
```

**Dependencias principales:**

```bash
npm i fastify @fastify/helmet @fastify/rate-limit @fastify/cookie @fastify/static \
      zod @prisma/client prisma argon2 bullmq ioredis
npm i -D typescript tsx @types/node
```

`package.json` (lo esencial). El proyecto usa módulos ES para permitir `await` en el nivel superior:

```json
{
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json && npm --prefix web ci && npm --prefix web run build"
  }
}
```

En `tsconfig.json` usa `"module": "NodeNext"`, `"target": "ES2022"` y `"outDir": "dist"`.

Antes del primer despliegue, crea la migración inicial en tu computadora y súbela al repositorio:

```bash
npx prisma migrate dev --name inicial
```

---

## 3. Variables de entorno y validación

Estas variables se configuran en Easypanel (sección 11), nunca en el repositorio.

```bash
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://$(PRIMARY_DOMAIN)

# Easypanel nombra los servicios internos como <proyecto>_<servicio>
DATABASE_URL=postgres://postgres:CLAVE_LARGA@estudio_postgres:5432/estudio
REDIS_URL=redis://default:CLAVE_LARGA@estudio_redis:6379

DATA_DIR=/data
ENCRYPTION_KEY=          # openssl rand -base64 32

# Proveedores de guion (usa los que tengas)
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
GROQ_API_KEY=

# Clips
PEXELS_API_KEY=
PIXABAY_API_KEY=

# TikTok (opcional, sección 9)
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_REDIRECT_URI=https://estudio.tudominio.com/api/tiktok/callback
```

Genera las claves secretas en tu computadora:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 24   # contraseñas de Postgres y Redis
```

`src/env.ts` hace que la app no arranque si falta algo o está mal formado:

```ts
import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "production"]).default("production"),
  PORT: z.coerce.number().default(3000),
  PUBLIC_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  DATA_DIR: z.string().default("/data"),
  ENCRYPTION_KEY: z.string().refine(
    (v) => Buffer.from(v, "base64").length === 32,
    "ENCRYPTION_KEY debe ser base64 de 32 bytes"
  ),
  ANTHROPIC_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  PEXELS_API_KEY: z.string().optional(),
  PIXABAY_API_KEY: z.string().optional(),
  TIKTOK_CLIENT_KEY: z.string().optional(),
  TIKTOK_CLIENT_SECRET: z.string().optional(),
  TIKTOK_REDIRECT_URI: z.string().url().optional(),
});

export const env = Env.parse(process.env);
```

---

## 4. Modelo de datos

`prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  passwordHash String
  sessions     Session[]
  createdAt    DateTime  @default(now())
}

model Session {
  id        String   @id @default(uuid())
  tokenHash String   @unique
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  userId    String
  expiresAt DateTime
}

enum ModoPublicacion {
  DESCARGA          // solo deja el MP4 listo
  BORRADOR_TIKTOK   // lo envía a borradores de TikTok
  DIRECTO_TIKTOK    // publicación directa (requiere auditoría)
}

enum EstadoHistoria {
  GUION
  CLIPS
  VOZ
  RENDER
  LISTA
  SUBIDA
  ERROR
}

model Serie {
  id              String          @id @default(uuid())
  nombre          String
  tipo            String          // "Reflexión" o "Historia"
  temas           String[]        // lista de temas; vacía = tema libre
  duracion        Int             @default(65)
  cron            String          // ej. "0 9 * * *" = todos los días a las 9:00
  zonaHoraria     String          @default("America/Lima")
  motor           String          @default("groq")
  voz             Json            // { proveedor, modelo, nombre }
  modoPublicacion ModoPublicacion @default(DESCARGA)
  activa          Boolean         @default(true)
  historias       Historia[]
}

model Historia {
  id          String         @id @default(uuid())
  serie       Serie?         @relation(fields: [serieId], references: [id], onDelete: SetNull)
  serieId     String?
  estado      EstadoHistoria @default(GUION)
  titulo      String?
  guion       Json?
  escenas     Json?          // texto, keywords, clip (id, fuente, autor, página, licencia), duración
  descripcion String?        // texto final para TikTok con créditos
  archivo     String?        // nombre del MP4 dentro de DATA_DIR/videos
  publishId   String?
  error       String?
  creadaEn    DateTime       @default(now())
}

model TikTokCuenta {
  id              String   @id @default(uuid())
  openId          String   @unique
  accessTokenEnc  String   // cifrado con AES-256-GCM
  refreshTokenEnc String
  expiraEn        DateTime
  scopes          String
}
```

---

## 5. Seguridad de la aplicación

### 5.1 Arranque del servidor

`src/index.ts`:

```ts
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { env } from "./env";
import { registrarAuth } from "./seguridad/auth";
import { iniciarWorker } from "./cola/cola";

const app = Fastify({
  trustProxy: true,          // detrás del proxy de Easypanel: IP real y HTTPS correctos
  bodyLimit: 1_000_000,      // 1 MB; la app no recibe archivos del usuario
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

// ...registrar rutas de /api aquí

await app.register(fastifyStatic, { root: path.resolve("web/dist") });
app.setNotFoundHandler((req, reply) =>
  req.url.startsWith("/api/") ? reply.code(404).send({ error: "No encontrado" }) : reply.sendFile("index.html")
);

await iniciarWorker();
await app.listen({ port: env.PORT, host: "0.0.0.0" });
```

Con `connect-src 'self'`, el navegador no puede llamar a servicios externos aunque alguien inyecte código: todo pasa por tu API.

### 5.2 Login y sesiones

Para una herramienta personal basta con un usuario administrador. Las contraseñas se guardan con argon2id, y la sesión es un token aleatorio en una cookie `httpOnly`; en la base de datos solo se guarda su hash.

`src/seguridad/auth.ts`:

```ts
import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db";

const sha256 = (t: string) => createHash("sha256").update(t).digest("hex");
const RUTAS_PUBLICAS = new Set(["/api/login", "/api/tiktok/callback"]);
const DIAS_SESION = 7;

export async function registrarAuth(app: FastifyInstance) {
  app.post("/api/login", {
    config: { rateLimit: { max: 5, timeWindow: "15 minutes" } },
  }, async (req, reply) => {
    const { email, password } = z.object({
      email: z.string().email(),
      password: z.string().min(12).max(200),
    }).parse(req.body);

    const user = await db.user.findUnique({ where: { email } });
    const valido = user ? await argon2.verify(user.passwordHash, password) : false;
    if (!user || !valido) return reply.code(401).send({ error: "Correo o contraseña incorrectos" });

    const token = randomBytes(32).toString("base64url");
    await db.session.create({
      data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + DIAS_SESION * 864e5) },
    });
    reply.setCookie("sid", token, {
      httpOnly: true, secure: true, sameSite: "strict", path: "/", maxAge: DIAS_SESION * 86400,
    });
    return { ok: true };
  });

  app.post("/api/logout", async (req, reply) => {
    const token = req.cookies.sid;
    if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
    reply.clearCookie("sid", { path: "/" });
    return { ok: true };
  });

  // Protege todas las rutas /api excepto las públicas
  app.addHook("onRequest", async (req, reply) => {
    const ruta = req.routeOptions.url ?? req.url;
    if (!req.url.startsWith("/api/") || RUTAS_PUBLICAS.has(ruta)) return;
    const token = req.cookies.sid;
    const sesion = token
      ? await db.session.findUnique({ where: { tokenHash: sha256(token) } })
      : null;
    if (!sesion || sesion.expiresAt < new Date()) {
      return reply.code(401).send({ error: "Inicia sesión para continuar" });
    }
  });
}
```

`src/scripts/crear-admin.ts`, para crear el usuario desde la consola del contenedor:

```ts
import argon2 from "argon2";
import { createInterface } from "node:readline/promises";
import { db } from "../db";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = await rl.question("Correo del administrador: ");
const password = await rl.question("Contraseña (mínimo 12 caracteres): ");
rl.close();
if (password.length < 12) throw new Error("La contraseña es demasiado corta");

await db.user.create({ data: { email, passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } });
console.log("Administrador creado");
process.exit(0);
```

### 5.3 Cifrado de tokens

Los tokens de TikTok dan acceso a tu cuenta. Se guardan cifrados con AES-256-GCM usando `ENCRYPTION_KEY`.

`src/seguridad/cifrado.ts`:

```ts
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env";

const CLAVE = Buffer.from(env.ENCRYPTION_KEY, "base64");

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", CLAVE, iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString("base64")).join(".");
}

export function descifrar(paquete: string): string {
  const [iv, tag, datos] = paquete.split(".").map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", CLAVE, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString("utf8");
}
```

Si pierdes `ENCRYPTION_KEY`, tendrás que volver a conectar TikTok. Guárdala también en tu gestor de contraseñas.

### 5.4 Llamadas a los proveedores de IA desde el servidor

Las funciones del prototipo pasan al servidor casi sin cambios. La diferencia es que las claves salen de `env` y el frontend solo llama a `/api/guion`.

`src/servicios/guion.ts` (fragmento):

```ts
import { env } from "../env";

async function pedirJSON(url: string, init: RequestInit, servicio: string) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${servicio} respondió ${res.status}: ${data?.error?.message ?? "sin detalle"}`);
  return data;
}

export async function textoConGroq(prompt: string, modelo = "llama-3.3-70b-versatile") {
  if (!env.GROQ_API_KEY) throw new Error("Falta GROQ_API_KEY");
  const data = await pedirJSON("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: modelo,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  }, "Groq");
  return data.choices[0].message.content as string;
}

// textoConGemini, textoConOpenAI y textoConClaude siguen el mismo patrón que el prototipo.
// Para Claude usa el header "x-api-key": env.ANTHROPIC_API_KEY y "anthropic-version": "2023-06-01".
```

Valida siempre el JSON que devuelve el modelo antes de usarlo:

```ts
import { z } from "zod";

export const GuionSchema = z.object({
  titulo: z.string().min(1).max(120),
  escenas: z.array(z.object({
    texto: z.string().min(1).max(400),
    keywords: z.array(z.string().max(40)).min(1).max(3),
  })).min(3).max(20),
  hashtags: z.array(z.string().max(40)).max(8).default([]),
});
```

### 5.5 Búsqueda y descarga segura de clips

Tres reglas:

1. **Caché de 24 horas.** Pixabay exige guardar en caché los resultados durante ese tiempo; aplícalo también a Pexels para no gastar tu límite.
2. **Descargar al servidor.** Pixabay no permite enlazar de forma permanente a sus archivos y recomienda alojarlos en tu servidor.
3. **Lista blanca de dominios.** Solo se descargan archivos de los CDN de Pexels y Pixabay. Así evitas que una URL manipulada haga que tu servidor acceda a direcciones internas (SSRF).

`src/servicios/clips.ts` (fragmento):

```ts
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import IORedis from "ioredis";
import { env } from "../env";

const redis = new IORedis(env.REDIS_URL);
const HOSTS_PERMITIDOS = new Set(["videos.pexels.com", "cdn.pixabay.com"]);
const MAX_BYTES = 150 * 1024 * 1024;

export async function buscarConCache<T>(clave: string, buscar: () => Promise<T>): Promise<T> {
  const guardado = await redis.get(clave);
  if (guardado) return JSON.parse(guardado);
  const resultado = await buscar();
  await redis.set(clave, JSON.stringify(resultado), "EX", 86_400);
  return resultado;
}

export async function descargarClip(url: string, destino: string) {
  let actual = new URL(url);
  for (let saltos = 0; saltos < 4; saltos++) {
    if (actual.protocol !== "https:" || !HOSTS_PERMITIDOS.has(actual.hostname)) {
      throw new Error(`Dominio no permitido: ${actual.hostname}`);
    }
    const res = await fetch(actual, { redirect: "manual", signal: AbortSignal.timeout(90_000) });
    const destinoRedir = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && destinoRedir) {
      actual = new URL(destinoRedir, actual);   // la redirección también pasa por la lista blanca
      continue;
    }
    if (!res.ok || !res.body) throw new Error(`Descarga fallida (${res.status})`);
    if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("Clip demasiado grande");

    let bytes = 0;
    const limite = new Transform({
      transform(trozo, _enc, cb) {
        bytes += trozo.length;
        bytes > MAX_BYTES ? cb(new Error("Clip demasiado grande")) : cb(null, trozo);
      },
    });
    await pipeline(Readable.fromWeb(res.body as any), limite, createWriteStream(destino));
    return;
  }
  throw new Error("Demasiadas redirecciones");
}
```

Si en los registros ves "Dominio no permitido" con un host legítimo de Pexels o Pixabay, añádelo a la lista después de comprobarlo.

---

## 6. Voz en off en el servidor

Guarda cada audio como archivo dentro de la carpeta de trabajo de la historia. Gemini TTS devuelve audio PCM crudo (normalmente 16 bits, 24 kHz, mono) que hay que envolver en WAV; OpenAI devuelve MP3 directamente.

`src/servicios/voz.ts` (fragmento):

```ts
import { writeFile } from "node:fs/promises";
import { env } from "../env";

function pcmAWav(pcm: Buffer, rate = 24000): Buffer {
  const cab = Buffer.alloc(44);
  cab.write("RIFF", 0); cab.writeUInt32LE(36 + pcm.length, 4); cab.write("WAVE", 8);
  cab.write("fmt ", 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(1, 22);
  cab.writeUInt32LE(rate, 24); cab.writeUInt32LE(rate * 2, 28); cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34);
  cab.write("data", 36); cab.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([cab, pcm]);
}

export async function vozGemini(texto: string, destino: string, modelo = "gemini-3.1-flash-tts-preview", voz = "Kore") {
  if (!env.GEMINI_API_KEY) throw new Error("Falta GEMINI_API_KEY");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Narra con voz cálida, pausada y cercana: ${texto}` }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } },
      },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Gemini TTS ${res.status}: ${data?.error?.message}`);
  const parte = data.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data);
  if (!parte) throw new Error("Gemini TTS no devolvió audio");
  const rate = Number(parte.inlineData.mimeType?.match(/rate=(\d+)/)?.[1]) || 24000;
  await writeFile(destino, pcmAWav(Buffer.from(parte.inlineData.data, "base64"), rate));
}

export async function vozOpenAI(texto: string, destino: string, modelo = "gpt-4o-mini-tts", voz = "coral") {
  if (!env.OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY");
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: modelo, voice: voz, input: texto, response_format: "mp3",
      instructions: "Voz cálida, pausada y cercana, en español latinoamericano neutro.",
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`OpenAI TTS ${res.status}: ${await res.text()}`);
  await writeFile(destino, Buffer.from(await res.arrayBuffer()));
}
```

Para respetar los límites por minuto del nivel gratuito, genera las escenas **una por una** y, ante un error 429, espera y reintenta (la cola de la sección 8 lo hace con `backoff`).

---

## 7. Render del video final con ffmpeg

### 7.1 Qué produce

- MP4 vertical 1080×1920, 30 fps, H.264 + AAC, con `faststart` para que empiece a reproducirse rápido.
- Cada clip se escala, se recorta al formato vertical y dura exactamente lo que dura su audio, más 0,4 s de pausa. Si el clip es más corto, se repite en bucle.
- Subtítulos quemados en el video, colocados más arriba del borde inferior para que no los tape la interfaz de TikTok.
- Música de fondo opcional que baja de volumen automáticamente cuando habla la voz. Usa solo música con licencia libre (por ejemplo, la biblioteca de audio de Pixabay); la música de la biblioteca de TikTok no se puede añadir desde fuera.

### 7.2 Ejecutar ffmpeg de forma segura

Nunca construyas un comando de texto para pasarlo a la terminal. Pasa los argumentos como lista, usa nombres de archivo generados por tu código y fija un tiempo máximo.

`src/render/ffmpeg.ts`:

```ts
import { spawn } from "node:child_process";

export function ffmpeg(args: string[], cwd: string, timeoutMs = 15 * 60_000) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { cwd });
    let errores = "";
    p.stderr.on("data", (d) => { errores = (errores + d).slice(-4000); });
    const t = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.on("close", (code) => {
      clearTimeout(t);
      code === 0 ? resolve() : reject(new Error(`ffmpeg terminó con código ${code}: ${errores}`));
    });
  });
}

export function duracion(archivo: string, cwd: string) {
  return new Promise<number>((resolve, reject) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", archivo], { cwd });
    let salida = "";
    p.stdout.on("data", (d) => (salida += d));
    p.on("close", (code) => {
      const s = Number(salida.trim());
      code === 0 && Number.isFinite(s) ? resolve(s) : reject(new Error(`ffprobe no pudo leer ${archivo}`));
    });
  });
}
```

### 7.3 Subtítulos

`src/render/subtitulos.ts` genera un archivo ASS. El texto se limpia de caracteres que ASS interpreta como comandos.

```ts
const tiempo = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = (s % 60).toFixed(2).padStart(5, "0");
  return `${h}:${String(m).padStart(2, "0")}:${seg}`;
};

const limpiar = (t: string) => t.replace(/[\\{}]/g, "").replace(/\s+/g, " ").trim();

export function crearASS(tramos: { inicio: number; fin: number; texto: string }[]) {
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Voz,DejaVu Serif,66,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,0,0,0,0,100,100,0,0,1,4,2,2,90,90,460,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${tramos.map((t) => `Dialogue: 0,${tiempo(t.inicio)},${tiempo(t.fin)},Voz,,0,0,0,,${limpiar(t.texto)}`).join("\n")}
`;
}
```

Si quieres otra fuente, pon el archivo `.ttf` con licencia libre en `fonts/` y cambia `DejaVu Serif` por su nombre.

### 7.4 Pipeline completo

`src/render/render.ts`:

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ffmpeg, duracion } from "./ffmpeg";
import { crearASS } from "./subtitulos";

const VF = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p";
const PAUSA = 0.4;

type Escena = { texto: string; clip: string; audio: string };   // nombres de archivo dentro de dir

export async function renderizar(dir: string, escenas: Escena[], musica?: string) {
  const videos: string[] = [];
  const audios: string[] = [];
  const tramos: { inicio: number; fin: number; texto: string }[] = [];
  let t = 0;

  for (const [i, e] of escenas.entries()) {
    // 1. Audio normalizado con la pausa al final
    const a = `a${i}.wav`;
    await ffmpeg(["-i", e.audio, "-af", `apad=pad_dur=${PAUSA}`, "-ar", "48000", "-ac", "2", a], dir);
    const d = await duracion(a, dir);

    // 2. Clip vertical con la duración exacta del audio
    const v = `v${i}.mp4`;
    await ffmpeg([
      "-stream_loop", "-1", "-i", e.clip, "-t", d.toFixed(3),
      "-vf", VF, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", v,
    ], dir);

    videos.push(v);
    audios.push(a);
    tramos.push({ inicio: t, fin: t + d - PAUSA, texto: e.texto });
    t += d;
  }

  // 3. Unir partes (todas tienen el mismo formato, así que no se recodifican)
  await writeFile(join(dir, "videos.txt"), videos.map((f) => `file '${f}'`).join("\n"));
  await writeFile(join(dir, "audios.txt"), audios.map((f) => `file '${f}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-i", "videos.txt", "-c", "copy", "video.mp4"], dir);
  await ffmpeg(["-f", "concat", "-i", "audios.txt", "-c", "copy", "voz.wav"], dir);
  await writeFile(join(dir, "subs.ass"), crearASS(tramos));

  // 4. Mezcla final: subtítulos, voz, música con ducking y volumen para redes
  const args = ["-i", "video.mp4", "-i", "voz.wav"];
  let filtro = "[0:v]subtitles=subs.ass:fontsdir=/app/fonts[v];";
  if (musica) {
    args.push("-stream_loop", "-1", "-i", musica);
    filtro +=
      "[2:a]volume=0.25[m];[1:a]asplit=2[vz][sc];" +
      "[m][sc]sidechaincompress=threshold=0.03:ratio=8:attack=20:release=500[duck];" +
      "[vz][duck]amix=inputs=2:duration=first:normalize=0[mix];";
  } else {
    filtro += "[1:a]anull[mix];";
  }
  filtro += "[mix]loudnorm=I=-14:TP=-1.5:LRA=11[a]";

  args.push(
    "-filter_complex", filtro, "-map", "[v]", "-map", "[a]",
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", "-t", t.toFixed(3),
    "final.mp4"
  );
  await ffmpeg(args, dir);
  return { archivo: join(dir, "final.mp4"), duracion: t };
}
```

Al terminar, mueve `final.mp4` a `DATA_DIR/videos/<id>.mp4` y borra la carpeta de trabajo.

### 7.5 Descargar el video desde la app

La descarga pasa por una ruta protegida por la sesión. La ruta del archivo se arma con el ID de la base de datos, nunca con texto que envíe el usuario.

```ts
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

app.get("/api/historias/:id/descargar", async (req, reply) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const h = await db.historia.findUnique({ where: { id } });
  if (!h?.archivo) return reply.code(404).send({ error: "El video todavía no está listo" });

  const ruta = path.join(env.DATA_DIR, "videos", `${h.id}.mp4`);
  const { size } = await stat(ruta);
  reply
    .header("Content-Type", "video/mp4")
    .header("Content-Length", size)
    .header("Content-Disposition", `attachment; filename="historia-${h.id.slice(0, 8)}.mp4"`);
  return reply.send(createReadStream(ruta));
});
```

En el frontend, el botón es un enlace normal: `<a href={`/api/historias/${id}/descargar`}>Descargar MP4</a>`. En el celular se guarda en Descargas o en Archivos, desde donde puedes subirlo a TikTok o abrirlo en CapCut.

Junto al botón, muestra la descripción con créditos y un botón para copiarla.

---

## 8. Programador de historias

### 8.1 Cómo funciona

1. Creas una **serie**: tipo, lista de temas, duración, horario, motor de guion, voz y qué hacer al terminar.
2. El programador ejecuta la serie según su horario (formato cron, con zona horaria).
3. Cada ejecución crea una historia y avanza por estados: `GUION → CLIPS → VOZ → RENDER → LISTA`.
4. Según el modo, la historia queda para descargar, se envía a borradores de TikTok o se publica directo.
5. Si un paso falla, se reintenta con espera creciente; si sigue fallando, queda en `ERROR` con el motivo visible en la app.

Ejemplos de horario:

| Cron | Significado |
|---|---|
| `0 9 * * *` | Todos los días a las 9:00 |
| `0 9,19 * * *` | Todos los días a las 9:00 y 19:00 |
| `0 18 * * 1-5` | De lunes a viernes a las 18:00 |
| `30 7 * * 0` | Domingos a las 7:30 |

### 8.2 Cola y programador

`src/cola/cola.ts`:

```ts
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { env } from "../env";
import { crearHistoria, publicarHistoria, limpiarArchivos } from "./trabajos";

const conexion = new IORedis(env.REDIS_URL, { maxRetriesPerRequest: null });
export const cola = new Queue("historias", { connection: conexion });

const opcionesTrabajo = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 60_000 },
  removeOnComplete: 200,
  removeOnFail: 500,
};

export async function programarSerie(serie: { id: string; cron: string; zonaHoraria: string; activa: boolean }) {
  const idProgramador = `serie-${serie.id}`;
  if (!serie.activa) {
    await cola.removeJobScheduler(idProgramador);
    return;
  }
  await cola.upsertJobScheduler(
    idProgramador,
    { pattern: serie.cron, tz: serie.zonaHoraria },
    { name: "crear-historia", data: { serieId: serie.id }, opts: opcionesTrabajo }
  );
}

export async function iniciarWorker() {
  // Limpieza diaria de archivos temporales y videos antiguos
  await cola.upsertJobScheduler("limpieza", { pattern: "0 4 * * *" }, { name: "limpiar" });

  new Worker("historias", async (job) => {
    if (job.name === "crear-historia") return crearHistoria(job.data.serieId);
    if (job.name === "publicar") return publicarHistoria(job.data.historiaId);
    if (job.name === "limpiar") return limpiarArchivos();
  }, { connection: conexion, concurrency: 1 });   // un render a la vez
}
```

Llama a `programarSerie` cada vez que crees, edites, pauses o borres una serie desde la app.

### 8.3 El trabajo de crear una historia

`src/cola/trabajos.ts` (esqueleto):

```ts
export async function crearHistoria(serieId: string) {
  const serie = await db.serie.findUniqueOrThrow({ where: { id: serieId } });
  const recientes = await db.historia.findMany({
    where: { serieId }, orderBy: { creadaEn: "desc" }, take: 20, select: { titulo: true, escenas: true },
  });

  const h = await db.historia.create({ data: { serieId, estado: "GUION" } });
  const dir = await crearCarpetaTrabajo(h.id);

  try {
    // 1. Guion: tema de la lista (o libre) y evitando repetir los últimos títulos
    const tema = serie.temas.length ? serie.temas[Math.floor(Math.random() * serie.temas.length)] : "";
    const guion = await generarGuion({
      motor: serie.motor, tipo: serie.tipo, tema, duracion: serie.duracion,
      evitar: recientes.map((r) => r.titulo).filter(Boolean),
    });
    await db.historia.update({ where: { id: h.id }, data: { guion, titulo: guion.titulo, estado: "CLIPS" } });

    // 2. Clips: no repetir clips usados en las últimas historias de la serie
    const usados = new Set(recientes.flatMap((r: any) => (r.escenas ?? []).map((e: any) => e.clip?.id)));
    const escenas = await elegirYDescargarClips(guion.escenas, dir, usados);
    await db.historia.update({ where: { id: h.id }, data: { escenas, estado: "VOZ" } });

    // 3. Voz escena por escena
    for (const [i, e] of escenas.entries()) {
      e.audio = await generarVoz(serie.voz, e.texto, dir, i);
    }
    await db.historia.update({ where: { id: h.id }, data: { estado: "RENDER" } });

    // 4. Render y descripción con créditos
    const { archivo } = await renderizar(dir, escenas);
    const final = await moverAVideos(archivo, h.id);
    await db.historia.update({
      where: { id: h.id },
      data: { archivo: final, descripcion: crearDescripcion(guion, escenas), estado: "LISTA" },
    });

    // 5. Publicación según el modo
    if (serie.modoPublicacion !== "DESCARGA") {
      await cola.add("publicar", { historiaId: h.id }, { attempts: 3, backoff: { type: "exponential", delay: 120_000 } });
    }
  } catch (err) {
    await db.historia.update({ where: { id: h.id }, data: { estado: "ERROR", error: String(err).slice(0, 800) } });
    throw err;   // BullMQ decide si reintenta
  } finally {
    await borrarCarpetaTemporal(dir);
  }
}
```

**Buenas prácticas del programador:**

- **Límites de uso.** Empieza con una o dos historias al día. Cada historia hace entre 10 y 30 búsquedas de clips y una llamada de voz por escena.
- **Variedad.** Rota temas y evita clips repetidos: TikTok reduce el alcance del contenido repetitivo o poco original.
- **Aviso por fallos.** Envíate un correo o un mensaje de Telegram cuando una historia termine en `ERROR`.
- **Retención.** La limpieza diaria puede borrar los MP4 con más de 15 días para no llenar el disco.

---

## 9. TikTok

### 9.1 Tres formas de publicar, de la más simple a la más compleja

| Opción | Cómo funciona | Qué necesitas | Recomendada para |
|---|---|---|---|
| **A. Descargar y programar en TikTok Studio** | Descargas el MP4 y lo subes en TikTok Studio desde el navegador, donde puedes agendarlo hasta 10 días antes. | Cuenta Creator o Business. Nada más. | Empezar ya, uso personal. |
| **B. Enviar a borradores por API** | La app sube el video; te llega una notificación en TikTok y terminas la publicación ahí. | App registrada en TikTok for Developers, scope `video.upload` aprobado. | Automatizar la subida sin perder la revisión final. |
| **C. Publicación directa por API** | La app publica sin abrir TikTok. | Scope `video.publish` aprobado y auditoría superada para publicar en público. | Productos para muchos creadores, no herramientas internas. |

En la opción A, al subir el video activa la etiqueta de contenido generado por IA si la voz o las imágenes son sintéticas, y pega la descripción con créditos.

### 9.2 Registrar la app en TikTok for Developers (opciones B y C)

1. Crea una cuenta en developers.tiktok.com y registra una app de tipo web.
2. Añade los productos **Login Kit** y **Content Posting API**.
3. Configura la URL de redirección: `https://estudio.tudominio.com/api/tiktok/callback`.
4. Publica en tu dominio una página de política de privacidad y otra de términos; TikTok las pide.
5. Solicita los scopes `user.info.basic` y `video.upload` (más `video.publish` para la opción C).
6. Envía la app a revisión con un video que muestre el flujo completo.
7. Copia `Client key` y `Client secret` a las variables de entorno de Easypanel.

Como la app sube el archivo directamente (`FILE_UPLOAD`), no necesitas verificar un dominio para servir los videos; eso solo hace falta si TikTok descarga el video desde una URL tuya (`PULL_FROM_URL`).

### 9.3 Conectar tu cuenta con OAuth

```ts
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { cifrar } from "../seguridad/cifrado";

app.get("/api/tiktok/conectar", async (_req, reply) => {
  const state = randomBytes(24).toString("base64url");
  reply.setCookie("tt_state", state, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/api/tiktok", maxAge: 600,
  });
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.search = new URLSearchParams({
    client_key: env.TIKTOK_CLIENT_KEY!,
    response_type: "code",
    scope: "user.info.basic,video.upload",
    redirect_uri: env.TIKTOK_REDIRECT_URI!,
    state,
  }).toString();
  return reply.redirect(url.toString());
});

// Ruta pública: la protege el parámetro state, que evita ataques CSRF
app.get("/api/tiktok/callback", async (req, reply) => {
  const { code, state } = z.object({ code: z.string(), state: z.string() }).parse(req.query);
  if (!req.cookies.tt_state || req.cookies.tt_state !== state) {
    return reply.code(400).send("La conexión con TikTok no es válida. Inténtalo de nuevo.");
  }
  reply.clearCookie("tt_state", { path: "/api/tiktok" });

  const res = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: env.TIKTOK_CLIENT_KEY!,
      client_secret: env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: env.TIKTOK_REDIRECT_URI!,
    }),
  });
  const t = await res.json();
  if (!res.ok || !t.access_token) throw new Error(`TikTok no entregó el token: ${t.error_description ?? res.status}`);

  const datos = {
    accessTokenEnc: cifrar(t.access_token),
    refreshTokenEnc: cifrar(t.refresh_token),
    expiraEn: new Date(Date.now() + t.expires_in * 1000),
    scopes: t.scope,
  };
  await db.tikTokCuenta.upsert({ where: { openId: t.open_id }, create: { openId: t.open_id, ...datos }, update: datos });
  return reply.redirect("/ajustes?tiktok=conectado");
});
```

El token de acceso caduca pronto. Antes de cada subida, si `expiraEn` ya pasó o está cerca, pide uno nuevo al mismo endpoint con `grant_type=refresh_token` y guarda ambos tokens cifrados otra vez.

### 9.4 Enviar el video a borradores (opción B)

TikTok limita a 6 las solicitudes de inicio de subida por minuto para cada token, algo que el programador respeta de sobra. El archivo se sube en trozos: si pesa 64 MB o menos va en uno solo; si pesa más, en trozos de 10 MB, y el último absorbe el resto.

```ts
import { open, stat } from "node:fs/promises";

async function leerRango(archivo: string, inicio: number, fin: number) {
  const fh = await open(archivo, "r");
  try {
    const buf = Buffer.alloc(fin - inicio + 1);
    await fh.read(buf, 0, buf.length, inicio);
    return buf;
  } finally {
    await fh.close();
  }
}

export async function subirABorradores(accessToken: string, archivo: string) {
  const { size } = await stat(archivo);
  const MB = 1024 * 1024;
  const trozo = size <= 64 * MB ? size : 10 * MB;
  const total = Math.floor(size / trozo);

  const init = await fetch("https://open.tiktokapis.com/v2/post/publish/inbox/video/init/", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({
      source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: trozo, total_chunk_count: total },
    }),
  });
  const j = await init.json();
  if (j.error?.code !== "ok") throw new Error(`TikTok rechazó la subida: ${j.error?.code} ${j.error?.message}`);
  const { upload_url, publish_id } = j.data;

  for (let i = 0; i < total; i++) {
    const inicio = i * trozo;
    const fin = i === total - 1 ? size - 1 : inicio + trozo - 1;
    const r = await fetch(upload_url, {
      method: "PUT",
      headers: { "Content-Type": "video/mp4", "Content-Range": `bytes ${inicio}-${fin}/${size}` },
      body: await leerRango(archivo, inicio, fin),
    });
    if (![200, 201, 206].includes(r.status)) throw new Error(`Falló el trozo ${i + 1} de ${total}: ${r.status}`);
  }
  return publish_id as string;   // guárdalo en Historia.publishId
}
```

Después consulta el estado con `POST https://open.tiktokapis.com/v2/post/publish/status/fetch/` enviando `{ "publish_id": "..." }`, y marca la historia como `SUBIDA` cuando TikTok la confirme.

### 9.5 Publicación directa (opción C)

Cambia estas cosas respecto a los borradores:

- El endpoint es `/v2/post/publish/video/init/` y requiere el scope `video.publish`.
- Antes de publicar, consulta `/v2/post/publish/creator_info/query/` para conocer las opciones de privacidad permitidas; el valor que envíes debe ser una de ellas.
- En `post_info` envía el título (la descripción con créditos) y `is_aigc: true`, que añade la etiqueta de contenido generado por IA.
- TikTok exige que la interfaz de tu app muestre ciertos elementos antes de publicar, como la elección de privacidad; revisa sus guías de UX antes de pedir la auditoría.
- Sin auditoría, recuerda: publicaciones solo privadas, máximo 5 usuarios en 24 horas y cuentas privadas.

---

## 10. CapCut

CapCut no ofrece una API pública para editar, renderizar o publicar desde tu servidor, y su conexión con TikTok funciona solo dentro de la app móvil de CapCut. No hay forma oficial de que tu app "envíe a CapCut".

Si quieres retocar algún video a mano:

1. Descarga el MP4 desde la app.
2. Ábrelo en CapCut (móvil) y haz los ajustes.
3. Exporta y comparte a TikTok desde la propia app de CapCut, con tu cuenta vinculada.

Para la mayoría de las historias no hace falta: el render de ffmpeg ya incluye subtítulos, voz, música y formato vertical.

---

## 11. Despliegue en Easypanel

### 11.1 Dockerfile

```dockerfile
# ---- Etapa de construcción ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

# ---- Imagen final ----
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg fonts-dejavu-core openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/web/dist ./web/dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/fonts ./fonts
RUN mkdir -p /data/videos /data/trabajo && chown -R node:node /data
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
```

Deja `prisma` en `dependencies` (no en `devDependencies`) para que `migrate deploy` funcione en la imagen final.

`.dockerignore`:

```
node_modules
.env*
.git
dist
web/node_modules
*.mp4
```

### 11.2 Preparar el servidor

- **Recursos.** Como punto de partida, 2 vCPU y 4 GB de RAM; el render con ffmpeg es la tarea más pesada.
- **Acceso SSH.** Solo con llave, sin contraseña, y sin entrar como root.
- **Firewall.** Abre únicamente 22 (SSH), 80 y 443. El panel de Easypanel (puerto 3000) debería quedar accesible solo desde tu IP o detrás de un dominio con HTTPS.
- **Easypanel.** Contraseña fuerte y verificación en dos pasos activada.
- **Actualizaciones.** Mantén al día el sistema operativo y Easypanel.

### 11.3 Paso a paso en Easypanel

1. **Crear el proyecto.** Nuevo proyecto llamado `estudio`.

2. **Postgres.** Nuevo servicio Postgres llamado `postgres`, con una contraseña generada. No publiques su puerto. Copia la URL de conexión interna para `DATABASE_URL`.

3. **Redis.** Nuevo servicio Redis llamado `redis`, con contraseña. Tampoco publiques su puerto. Arma `REDIS_URL` con esa contraseña.

4. **Servicio de la app.** Nuevo servicio **App** llamado `app`.
   - **Source:** GitHub, repositorio `tuusuario/estudio` (privado; configura antes el token de GitHub en el servidor), rama `main`, Build Path `/`.
   - **Build:** Dockerfile.

5. **Environment.** Pega las variables de la sección 3. Easypanel reemplaza `$(PRIMARY_DOMAIN)` por el dominio principal del servicio. Trata este contenido como secreto.

6. **Storage.** Añade un montaje de tipo **Volume** llamado `datos` en la ruta `/data`. Si más tarde el contenedor no puede escribir ahí, revisa los permisos: el proceso corre con el usuario `node`.

7. **Domains.** Añade `estudio.tudominio.com` (con el registro DNS apuntando a tu servidor), activa HTTPS y pon **puerto 3000**. Márcalo como principal.

8. **Security (opcional).** Activa HTTP Basic Auth como capa extra: el proxy pide usuario y contraseña antes de llegar a la app. No sustituye al login de la app.

9. **Resources.** Pon un límite de memoria (por ejemplo 3072 MB) y de CPU (por ejemplo 1.5 núcleos) para que un render no deje sin recursos al resto del servidor.

10. **Deploy.** Pulsa Deploy y revisa la salida de la construcción. Si falla ahí, el error suele estar en el Dockerfile; si falla después, míralo en los registros del servicio.

11. **Primer usuario.** Abre **Shell** en el servicio y ejecuta:
    ```bash
    node dist/scripts/crear-admin.js
    ```

12. **Comprobar el volumen.** En la misma Shell:
    ```bash
    touch /data/prueba && ls -la /data && rm /data/prueba
    ```

13. **Despliegue automático.** Activa **Auto Deploy** para que cada push a `main` despliegue. La URL de despliegue contiene un token secreto: no la compartas.

14. **Backups.**
    - En **Storage**, programa copias del volumen `datos` hacia un proveedor externo y haz una restauración de prueba.
    - Programa también copias de Postgres.

### 11.4 Después de desplegar

- Entra a la app, conecta los servicios que uses y crea una serie de prueba con horario cercano.
- Comprueba que se genera la historia, que el MP4 se descarga y se reproduce bien en el celular.
- Revisa los registros: no deben aparecer claves ni tokens.

---

## 12. Lista de verificación de seguridad

**Claves y secretos**
- [ ] Ninguna clave en el repositorio ni en el frontend; todas en Environment de Easypanel.
- [ ] `ENCRYPTION_KEY` generada con `openssl` y guardada en un gestor de contraseñas.
- [ ] Tokens de TikTok guardados cifrados.
- [ ] Registros sin cabeceras de autorización ni cookies.

**Acceso**
- [ ] Login con argon2id, límite de 5 intentos cada 15 minutos.
- [ ] Cookie de sesión `httpOnly`, `secure` y `sameSite`.
- [ ] Todas las rutas `/api` protegidas salvo login y callback de TikTok.
- [ ] Basic Auth de Easypanel como capa extra (opcional).

**Aplicación**
- [ ] Entradas validadas con zod, incluido el JSON que devuelven los modelos.
- [ ] Descarga de clips solo desde dominios permitidos, con límite de tamaño y tiempo.
- [ ] ffmpeg ejecutado con lista de argumentos, sin terminal, con tiempo máximo.
- [ ] Descargas de videos solo con sesión y rutas construidas desde el ID.
- [ ] Cabeceras de seguridad con helmet y `connect-src 'self'`.

**Infraestructura**
- [ ] Postgres y Redis sin puertos públicos y con contraseña.
- [ ] Contenedor con usuario sin privilegios (`node`).
- [ ] Firewall con solo 22, 80 y 443; SSH con llave; Easypanel con 2FA.
- [ ] Backups del volumen y de la base de datos, con restauración probada.
- [ ] Dependencias actualizadas (`npm audit` periódico).

**Contenido y plataforma**
- [ ] Créditos de cada clip guardados (fuente, autor, licencia) e incluidos en la descripción.
- [ ] Etiqueta de contenido generado por IA activada al publicar.
- [ ] Nada de bots o métodos no oficiales para publicar en TikTok.

---

## 13. Orden recomendado de construcción

1. **Fase 1, render manual.** Login, editor (el prototipo conectado a la API), generación de voz, render y descarga del MP4. Con esto ya puedes publicar usando TikTok Studio.
2. **Fase 2, programador.** Series, cola con BullMQ, historial con estados y avisos de error.
3. **Fase 3, TikTok por API.** Registro de la app, conexión OAuth y envío a borradores. Solo después, si tu caso encaja en las guías de TikTok, pide la publicación directa y la auditoría.
