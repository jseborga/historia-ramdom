# Estudio de voz en off

Aplicación que escribe el guion, busca clips libres, genera la voz y renderiza
un MP4 vertical con subtítulos listo para descargar. Un programador crea
historias de forma automática y, si lo configuras, las envía a TikTok.

Implementa la guía de `docs/guia-original.md`.

## Qué hace

- **Editor.** Escribe un guion con Claude, Gemini, OpenAI o Groq —eligiendo el
  modelo exacto—, te deja corregir las escenas y produce el video.
- **Render.** MP4 1080×1920, 30 fps, H.264 + AAC, subtítulos quemados, música
  de fondo opcional con *ducking* y volumen normalizado para redes.
- **Programador.** Series con horario cron y zona horaria; cada ejecución
  avanza `GUION → CLIPS → VOZ → RENDER → LISTA`.
- **TikTok (opcional).** OAuth, envío a borradores, publicación directa y
  **subidas programadas** a la hora que elijas.
- **Créditos.** Cada escena guarda fuente, autor, página y licencia del clip;
  se copian con un botón, sueltos o dentro de la descripción.
- **Descarga.** Ruta protegida por sesión; la ruta del archivo se arma con el
  ID de la base de datos.

## Arquitectura

```
Navegador → proxy HTTPS → API Fastify + worker BullMQ (un contenedor)
                              ├── Postgres (Prisma)
                              ├── Redis (cola y caché de búsquedas)
                              └── volumen /data (videos, trabajo, música)
```

El navegador solo habla con esta API. Todas las claves viven en variables de
entorno del servidor y nunca llegan al frontend (`connect-src 'self'`).

## Estructura

```
src/
├── index.ts              arranca API y worker
├── env.ts                valida variables de entorno
├── db.ts                 cliente Prisma
├── almacen.ts            carpetas de /data, retención y limpieza
├── seguridad/            cifrado AES-256-GCM y login con argon2id
├── servicios/            guion, voz, clips y TikTok
├── render/               ffmpeg, subtítulos .ass y pipeline
├── cola/                 colas, programador y trabajos
├── rutas/                endpoints HTTP
└── scripts/crear-admin.ts
web/                      frontend React + Vite
```

## Desarrollo local

Necesitas Node 22, ffmpeg y ffprobe en el PATH, y un Postgres y un Redis
accesibles.

```bash
npm install
cp .env.example .env          # rellena DATABASE_URL, REDIS_URL y ENCRYPTION_KEY
npx prisma migrate deploy
npm run dev                   # API en :3000
npm run dev:web               # frontend en :5173, con proxy a /api
npm run crear-admin           # crea un administrador de forma interactiva
```

En desarrollo la cookie de sesión se envía sin `secure` para que funcione sobre
http; en producción (`NODE_ENV=production`) siempre va con `secure`.

Genera los secretos así:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 24   # contraseñas de Postgres y Redis
```

Si pierdes `ENCRYPTION_KEY` tendrás que volver a conectar TikTok y volver a
cifrar los secretos del entorno: guárdala también en tu gestor de contraseñas.

## Login maestro

Puedes crear el administrador desde el entorno, sin entrar a la consola del
contenedor. En cada arranque la app lo crea o actualiza:

```bash
ADMIN_EMAIL=tu@correo.com
ADMIN_PASSWORD_HASH=$argon2id$v=19$m=65536,t=3,p=4$...
```

El hash se genera con el script incluido, que nunca guarda la contraseña:

```bash
node dist/scripts/cifrar-secreto.js --password     # imprime ADMIN_PASSWORD_HASH
```

`ADMIN_PASSWORD` (la contraseña en claro) existe solo como atajo para el primer
arranque; en cuanto puedas, cámbiala por el hash y bórrala del panel. El usuario
queda marcado como `maestro` en la base de datos, y `npm run crear-admin` sigue
disponible para crear otros usuarios a mano.

## Secretos del entorno: qué cifrar y qué no

Las variables sensibles admiten el formato `enc:<iv>.<tag>.<datos>`
(AES-256-GCM). Se generan así y se pegan tal cual en el panel:

```bash
ENCRYPTION_KEY=... node dist/scripts/cifrar-secreto.js
```

Admiten cifrado: `DATABASE_URL`, `REDIS_URL`, `ADMIN_PASSWORD`,
`ADMIN_PASSWORD_HASH`, las cuatro claves de IA, `PEXELS_API_KEY`,
`PIXABAY_API_KEY`, `TIKTOK_CLIENT_KEY` y `TIKTOK_CLIENT_SECRET`. Si una falla al
descifrarse, la app no arranca y el registro solo menciona el **nombre** de la
variable, nunca su valor.

**Qué protege esto y qué no.** `ENCRYPTION_KEY` vive en el mismo panel que las
demás variables, así que quien pueda leer el entorno completo puede descifrarlas.
Sirve contra las fugas reales y frecuentes —una captura de pantalla del panel, un
volcado de configuración, un backup o un `docker inspect` que acaba compartido—,
no contra alguien que ya tiene acceso al servidor. Lo verdaderamente importante
es, en este orden:

1. **Restringir quién entra al panel:** contraseña fuerte, 2FA, y el puerto de
   Easypanel cerrado salvo a tu IP.
2. **Que las claves no salgan nunca al navegador ni a los registros** (ya se
   cumple: `connect-src 'self'`, `redact` en el logger).
3. **Rotarlas de vez en cuando** y usar una clave distinta por servicio.
4. Si algún día el proyecto crece, mover los secretos a un gestor externo
   (Infisical, Vault, Doppler, AWS Secrets Manager), que es lo único que separa
   de verdad la clave del entorno que la usa.

El cifrado `enc:` es una capa extra barata, no un sustituto de los puntos 1 a 4.

## Comprobaciones

```bash
npm run typecheck             # backend
npm --prefix web run build    # frontend (incluye tsc -b)
npm run build                 # los dos, como en el Dockerfile
```

## Despliegue en Easypanel

1. Proyecto `estudio`, con servicios **Postgres** y **Redis** sin puerto
   público y con contraseña.
2. Servicio **App** apuntando a este repositorio, build por **Dockerfile**.
3. **Environment:** pega las variables de `.env.example` con tus valores.
4. **Storage:** volumen `datos` montado en `/data`.
5. **Domains:** tu dominio con HTTPS y **puerto 3000**.
6. **Resources:** límite de memoria y CPU para que un render no ahogue al
   servidor (por ejemplo 3072 MB y 1,5 núcleos).
7. **Deploy** y luego, desde la Shell del servicio:

```bash
node dist/scripts/crear-admin.js
touch /data/prueba && ls -la /data && rm /data/prueba
```

El contenedor ejecuta `prisma migrate deploy` antes de arrancar, así que la
migración inicial de `prisma/migrations/` se aplica sola.

Programa copias del volumen y de Postgres, y prueba una restauración.

## Límites de tamaño

| Variable | Por defecto | Qué hace |
|---|---|---|
| `MAX_CLIP_MB` | 150 | Corta la descarga de un clip que se pase, por cabecera y por bytes recibidos. |
| `MAX_VIDEO_MB` | 300 | Si el MP4 compilado se pasa, la historia queda en `ERROR` con el tamaño real y el límite en el mensaje. También se comprueba antes de subir a TikTok. |

Los dos límites se muestran en el editor para que no haya sorpresas.

## Modelos: Google AI Studio y el resto

Los proveedores renuevan sus modelos a menudo, así que los nombres se
configuran en el entorno y se pueden afinar sin tocar el código:

| Variable | Para qué |
|---|---|
| `GEMINI_MODELO` | Historias con Google AI Studio |
| `GEMINI_MODELO_VOZ` / `GEMINI_VOZ` | Voz con Google AI Studio |
| `ANTHROPIC_MODELO`, `OPENAI_MODELO`, `GROQ_MODELO` | Historias con los otros motores |
| `OPENAI_MODELO_VOZ` / `OPENAI_VOZ` | Voz con OpenAI |

Sobre esa base, el editor y cada serie pueden fijar su propio modelo de
historia y su propia voz, de modo que puedes combinar, por ejemplo, historias
con `gemini-2.5-flash` y voz con el modelo TTS de Gemini, o historia con Gemini
y voz con OpenAI. Si dejas el campo vacío se usa el valor del entorno.

## Créditos para TikTok

Cada escena guarda el clip que usó (id, fuente, autor, página y licencia). En la
pestaña **Historias** hay dos botones: *Copiar descripción* (título, hashtags,
aviso de contenido generado con IA y créditos) y *Copiar créditos* (solo la
lista, por si prefieres pegarla en un comentario). La misma lista está en
`GET /api/historias/:id/creditos`.

## Programar subidas

- **Por serie:** el horario cron decide cuándo se crea cada historia; si el modo
  no es "descarga", la subida sale en cuanto termina el render.
- **Por historia:** en el editor puedes fijar fecha y hora de subida antes de
  generarla, y en la lista de historias cada MP4 listo tiene su propio selector
  de fecha con el botón *Programar subida*. El retraso lo aplica la cola de
  BullMQ, así que sobrevive a reinicios del contenedor.

Recuerda que sin la auditoría de TikTok superada la publicación directa queda
privada; lo habitual es programar el envío a **borradores** y rematar en la app,
o descargar el MP4 y agendarlo en TikTok Studio.

## TikTok

- Sin auditoría superada, todo lo que publique la app queda privado, con un
  máximo de 5 usuarios en 24 horas y cuentas privadas.
- La ruta más realista es **descargar el MP4 y programarlo en TikTok Studio**.
- La alternativa intermedia es enviarlo a **borradores** por API y terminar la
  publicación en la app.
- Al publicar, activa la etiqueta de contenido generado por IA y pega la
  descripción con créditos que genera la app.
- No uses bots de navegador ni métodos no oficiales.

CapCut no tiene API pública: si quieres retocar un video, descárgalo y ábrelo
en la app móvil.

## Música de fondo

Copia archivos con licencia libre en `/data/musica`. Aparecen en el selector de
música del editor y de las series.

## Licencia de los clips

Cada escena guarda la fuente, el autor, la página y la licencia del clip, y la
descripción que genera la app los incluye. Pixabay exige cachear sus resultados
24 horas y alojar los archivos en tu servidor: las dos cosas están implementadas
en `src/servicios/clips.ts`, junto con una lista blanca de dominios que evita
que una URL manipulada haga que el servidor acceda a direcciones internas.
