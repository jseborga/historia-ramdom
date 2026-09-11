# Estudio de voz en off

Aplicación que escribe el guion, busca clips libres, genera la voz y renderiza
un MP4 vertical con subtítulos listo para descargar. Un programador crea
historias de forma automática y, si lo configuras, las envía a TikTok.

Implementa la guía de `docs/guia-original.md`.

## Qué hace

- **Editor.** Escribe un guion con Claude, Gemini, OpenAI o Groq, te deja
  corregir las escenas y produce el video.
- **Render.** MP4 1080×1920, 30 fps, H.264 + AAC, subtítulos quemados, música
  de fondo opcional con *ducking* y volumen normalizado para redes.
- **Programador.** Series con horario cron y zona horaria; cada ejecución
  avanza `GUION → CLIPS → VOZ → RENDER → LISTA`.
- **TikTok (opcional).** OAuth, envío a borradores y publicación directa.
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
npm run crear-admin           # crea el usuario administrador
```

En desarrollo la cookie de sesión se envía sin `secure` para que funcione sobre
http; en producción (`NODE_ENV=production`) siempre va con `secure`.

Genera los secretos así:

```bash
openssl rand -base64 32   # ENCRYPTION_KEY
openssl rand -base64 24   # contraseñas de Postgres y Redis
```

Si pierdes `ENCRYPTION_KEY` tendrás que volver a conectar TikTok: guárdala
también en tu gestor de contraseñas.

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

## Sobre los nombres de modelo

Los proveedores renuevan sus modelos a menudo. Los valores por defecto están
juntos en `src/servicios/guion.ts` (`MODELOS`) y en `src/servicios/voz.ts`
(`VOZ_POR_DEFECTO`); compruébalos antes de desplegar. El modelo de voz también
se puede cambiar desde la propia interfaz.

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
