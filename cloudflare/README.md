# El estudio en Cloudflare

Esta carpeta pone la app entera en **Cloudflare Containers**: la misma imagen
que en Easypanel (ffmpeg, Piper, las fuentes, la web), arrancada y vigilada por
un Worker. La rama `cloudflare` del repositorio es la que se instala aquí; la
rama de siempre sigue funcionando igual en Easypanel.

## Qué queda dónde

| Pieza | Dónde | Por qué |
|---|---|---|
| La app (API, web, renders, cola) | Contenedor de Cloudflare (`standard-2`: 1 vCPU, 6 GiB) | Es la imagen de siempre: no hay que reescribir nada |
| Vídeos, música, biblioteca, proyectos (`/data`) | **R2**, montado como disco con tigrisfs | El disco del contenedor se borra cada vez que se duerme |
| Archivos de trabajo de ffmpeg | Disco local del contenedor (`/tmp/trabajo`) | R2 montado es lento para lo que ffmpeg escribe y borra |
| Base de datos | **Postgres externo**: Neon o Supabase | Cloudflare no tiene Postgres (D1 es SQLite y el esquema usa cosas de Postgres) |
| Cola de trabajos | **Redis externo**: Upstash | BullMQ necesita Redis, y tiene que sobrevivir a que el contenedor duerma |

## Cómo se comporta

- **Duerme cuando nadie lo usa** y no cobra mientras duerme. Se duerme a los
  15 minutos sin visitas ni trabajo.
- **No se duerme a mitad de un render**: cada 5 minutos el Worker le pregunta a
  la app (`/api/interno/actividad`) si tiene algo en marcha o en cola.
- **Se despierta solo para lo programado**: antes de dormirse, la app le dice
  cuándo toca el siguiente trabajo (una serie, una subida programada, las
  métricas cada 6 h, la limpieza diaria) y el Worker pone una alarma 3 minutos
  antes.
- **Despertar tarda** entre medio minuto y un minuto (montar R2, migrar la
  base, arrancar). La primera visita después de dormir espera ese rato.
- Un solo contenedor: la app guarda la cola y las sesiones, y dos copias se
  pisarían.

## Coste aproximado

Plan **Workers Paid: US$5/mes**, más lo que esté encendido el contenedor:

- `standard-2` encendido: unos **US$0,06 por hora** (memoria y disco), más
  CPU solo mientras trabaja (hasta US$0,07 por hora renderizando).
- Con unas 3 horas al día encendido: **unos US$10–12/mes** en total.
- Encendido las 24 horas: **unos US$45/mes**.
- R2: 10 GB gratis, luego US$0,015 por GB al mes; bajar los vídeos no cuesta.
- Neon y Upstash tienen plan gratis. Upstash gratis son 500 000 comandos al
  mes; la cola consume unos cuantos miles por hora encendida, así que si se
  usa mucho conviene su plan de pago (unos US$10/mes).

Precios de Cloudflare comprobados en octubre de 2026:
<https://developers.cloudflare.com/containers/pricing/>.

## Instalarlo, paso a paso

### 1. Cloudflare

1. Crea la cuenta y activa **Workers Paid** (Workers & Pages → Plans).
2. **R2** → crea un bucket llamado `estudio-historias`.
3. R2 → **Manage API tokens** → crea un token con permiso **Object Read &
   Write** solo para ese bucket. Apunta el **Access Key ID**, el **Secret
   Access Key** y tu **Account ID** (aparece en la portada de R2).

### 2. Base de datos y Redis

1. **Neon** (<https://neon.tech>): crea un proyecto en la región más cercana
   (São Paulo, `sa-east-1`). Copia la cadena de conexión **directa** (sin
   `-pooler`) y añádele `?sslmode=require` si no lo trae. Es `DATABASE_URL`.
2. **Upstash** (<https://upstash.com>): crea una base Redis en la misma región.
   Copia la URL que empieza por `rediss://` (con dos s: va cifrada). Es
   `REDIS_URL`.

### 3. Traer lo que ya tienes en Easypanel (si quieres conservarlo)

- **La base de datos**, desde una máquina con acceso a las dos:

  ```sh
  pg_dump --no-owner --format=custom "URL_DE_EASYPANEL" > estudio.dump
  pg_restore --no-owner --dbname "URL_DE_NEON" estudio.dump
  ```

- **Los archivos de `/data`** a R2, con rclone (en el servidor de Easypanel):

  ```sh
  rclone config create r2 s3 provider=Cloudflare \
    access_key_id=TU_ACCESS_KEY secret_access_key=TU_SECRET \
    endpoint=https://TU_ACCOUNT_ID.r2.cloudflarestorage.com
  rclone copy /ruta/del/volumen/data r2:estudio-historias --progress
  ```

  Usa la **misma `ENCRYPTION_KEY`** que en Easypanel: con otra, los secretos
  guardados en la base no se podrían leer.

### 4. Configurar el Worker

En `cloudflare/wrangler.jsonc`, cambia `PUBLIC_URL` por la dirección que va a
tener (`https://estudio-historias.<tu-subdominio>.workers.dev`, o tu dominio).
El subdominio está en Workers & Pages → tu cuenta.

Luego, desde la carpeta `cloudflare`:

```sh
npm install
npx wrangler login
```

Y los secretos, uno por uno (te pide el valor):

```sh
npx wrangler secret put DATABASE_URL
npx wrangler secret put REDIS_URL
npx wrangler secret put ENCRYPTION_KEY
npx wrangler secret put API_TOKEN
npx wrangler secret put ADMIN_EMAIL
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

Y los del resto de la app que uses, con el mismo nombre que en Easypanel:
`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`PEXELS_API_KEY`, `PIXABAY_API_KEY`, `COVERR_API_KEY`, `TIKTOK_CLIENT_KEY`,
`TIKTOK_CLIENT_SECRET`, `TIKTOK_REDIRECT_URI`, `REDDIT_CLIENT_ID`… Todo lo
que tenga el Worker (vars y secretos) le llega a la app como variable de
entorno.

`API_TOKEN` es obligatorio aquí: con él pregunta el Worker si hay trabajo en
marcha. Si no lo tienes, créalo con `openssl rand -hex 24`.

### 5. Desplegar

Necesita **Docker** en tu computadora (Docker Desktop vale): wrangler
construye la imagen y la sube a Cloudflare.

```sh
npm run desplegar
```

La primera vez tarda (la imagen pesa unos 2,2 GB: ffmpeg, Piper y sus
voces). Después, solo sube lo que cambie.

Si no quieres instalar Docker, la acción de GitHub
`.github/workflows/cloudflare.yml` despliega sola cada vez que se sube algo a
la rama `cloudflare`: añade en el repositorio (Settings → Secrets and
variables → Actions) `CLOUDFLARE_API_TOKEN` (un token con permiso «Edit
Cloudflare Workers» y «Containers») y `CLOUDFLARE_ACCOUNT_ID`.

### 6. Entrar

Abre `PUBLIC_URL`. La primera vez tarda un minuto en arrancar; después entras
con `ADMIN_EMAIL` y `ADMIN_PASSWORD`, como siempre.

Si usas TikTok, cambia en su panel de desarrollador la dirección de retorno a
`PUBLIC_URL/api/tiktok/callback` y pon lo mismo en `TIKTOK_REDIRECT_URI`.

Para ver qué pasa por dentro: `npm run registros`, o en el panel de Cloudflare
→ Workers & Pages → estudio-historias → Logs.

## Lo que cambia respecto a Easypanel

- **Subidas de hasta 100 MB** por archivo (límite de Cloudflare en los planes
  Free y Pro): por eso `MAX_CLIP_MB` es 95. Un plan Business sube el límite a
  200 MB.
- **R2 montado es más lento que un disco**: la biblioteca y la Galería tardan
  un poco más en abrir archivos grandes. Los renders no lo notan, porque
  trabajan en el disco local y solo guardan el resultado.
- **El primer arranque tras dormir tarda un minuto.**
- El modo de contenedor que usa (`durable_object`) está en **beta pública**
  en Cloudflare: es el que usan sus ejemplos de R2 y de tareas programadas.

## Cambiar el tamaño

En `wrangler.jsonc`, `INSTANCIA`: `standard-2` (1 vCPU, 6 GiB) por defecto;
`standard-3` (2 vCPU, 8 GiB) renderiza casi el doble de rápido y cuesta un
tercio más por hora encendido; `standard-4` (4 vCPU, 12 GiB) para videoclips
largos. Se aplica la próxima vez que arranque.

## Volver a Easypanel

La rama de siempre no cambia. Para volver, se hace el camino inverso del paso
3: `pg_dump` de Neon a tu Postgres, y `rclone copy r2:estudio-historias` a tu
volumen de datos.
