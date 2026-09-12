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
- **Banco de historias.** Ideas pendientes que alimentan al programador, a mano
  o detectadas en Reddit.
- **Ganchos con puntuación.** El gancho es una escena propia con su rótulo; las
  métricas lo califican y los que funcionan se vuelven a usar solos.
- **Servidor MCP.** Claude puede consultar el banco, ver qué rinde y encargar
  historias hablando en lenguaje natural.
- **Editor de montaje.** Tres pistas independientes —vídeo, textos y voz— sobre
  el mismo tiempo, como CapCut: la narración se lee con una sola voz y su
  duración real sincroniza el resto. Vista previa con la voz real, tipo de
  letra, animaciones, efectos y presets de formato por red
  ([`docs/editor.md`](docs/editor.md)). Las series pueden dejar cada ejecución
  como montaje precargado para revisar antes de renderizar.
- **Párrafos largos y karaoke.** Escenas de hasta tres minutos que se van
  leyendo frase a frase o por bloques, con resaltado palabra a palabra, clips
  encontrados automáticamente por parecido con el texto y efectos de imagen.
- **Voces locales sin coste.** espeak-ng (robótica) y Piper (neural, la mejor
  sin pagar, con licencia apta para uso comercial); MBROLA opcional. Por
  defecto la mejor disponible. La narración
  se genera frase a frase y se mide, así que los textos caen donde se leen.
  Gemini y OpenAI cuando se quiera más.
- **Texto correcto, por país y por partes.** Los prompts exigen tildes, ñ y
  signos de apertura; se elige región (Bolivia por defecto, Latinoamérica o
  EE. UU.) con o sin modismos; tope de 350 s por vídeo y historias que
  continúan por partes.
- **Ensamblado con la narración al mando.** Voz medida → textos donde suenan →
  vídeo rellenado con clips largos al azar y un gancho de 4 s.
- **Vista previa.** El MP4 se reproduce en la propia app antes de descargarlo, y
  los clips candidatos se ven antes de elegir cuál aparece en cada escena.
- **Comprobación de servicios.** Un botón verifica que cada clave, la base de
  datos, Redis, ffmpeg y el volumen responden de verdad.
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

**Guía completa paso a paso: [`docs/despliegue-easypanel.md`](docs/despliegue-easypanel.md)**
(variables, volumen, dominio, primer usuario y solución de problemas).

Resumen:

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

Cada escena guarda el clip que usó (id, fuente, autor, página y licencia). La
**descripción para publicar** es corta a propósito, porque en TikTok cada
carácter cuenta: el gancho, hasta seis hashtags, los créditos agrupados por
fuente en una sola línea (`Clips: Pexels (Ana, Luis) · Pixabay (Pedro)`), la
música si es de Suno y el aviso de contenido creado con IA.

```
Nadie te contó lo de la casa del fondo.
#terror #casaembrujada #miedo
Clips: Pexels (Ana, Luis) · Pixabay (Pedro)
Música: Suno — https://suno.com/song/1f6a0b0e-…
Contenido creado con IA.
```

La **lista completa** (un clip por línea con su enlace) sigue disponible para
pegarla en un comentario o guardarla: *Copiar créditos* en Historias,
`GET /api/historias/:id/creditos`, y en Montaje el `.txt` de créditos, que lleva
la descripción corta arriba y la lista completa debajo.

## Categorías y planteamiento previo

Antes de escribir, la historia se puede **plantear**: se elige una categoría y
una subcategoría (o se sortean al azar), y el modelo decide título,
lineamientos, personajes, giro final y los criterios de búsqueda de clips.
Solo después escribe el guion, obligado a respetar ese planteamiento. Así las
historias no improvisan y los vídeos de fondo pegan con el género aunque la
frase concreta no lo diga.

Categorías: comedia, drama, terror, historia real, triunfo y superación, engaño
y traición, misterio, romance, aventura, reflexión, ciencia y curiosidades y
crimen; cada una con sus subcategorías (por ejemplo terror › casa embrujada,
carretera de noche, leyenda urbana, tecnología, bosque, ritual). Están en
`src/servicios/categorias.ts`, con el tono de cada género, palabras visuales en
inglés para buscar clips y hashtags cortos. La lista llega al frontend en
`GET /api/catalogo` (`categorias`).

Dónde se usa:

- **Editor** (pestaña Crear): selector de categoría y subcategoría, botón
  *Plantear al azar (título y lineamientos)* que muestra el planteamiento para
  revisarlo o cambiarlo (título, lineamientos, giro, criterios de clips), y
  después *Escribir guion con este planteamiento*. Sin categoría se escribe
  directo, como antes.
- **Series**: categoría fija, *al azar una distinta cada vez* o sin categoría.
  Cada ejecución plantea y escribe; las partes siguientes de una historia
  heredan la categoría concreta de la primera y no vuelven a plantear.
- **API**: `POST /api/premisa` devuelve el planteamiento; `POST /api/guion` y
  `POST /api/historias` aceptan `categoria`, `subcategoria` y `premisa`.
- **MCP**: `listar_categorias`, `plantear_historia`, y `categoria`,
  `subcategoria` y `premisa` en `escribir_guion` y `crear_historia`.

El guion guarda `categoria`, `subcategoria`, `premisa` y `keywords` (criterios
generales de clips). El ensamblador del editor busca clips con esos criterios
además de con lo que dice cada frase, así que un montaje de terror sale con
pasillos oscuros aunque la narración hable de una llamada.

## Editor de montaje

La pestaña **Montaje** abre una línea de tiempo al estilo CapCut: se crea desde
una historia con las escenas y los clips ya colocados en orden, y desde ahí se
cambia cada pieza. Texto con tamaño, color, posición y cuatro animaciones; el
clip de cada escena buscable por palabras; voz de IA o archivo propio; música de
la biblioteca o subida; y un preset de formato por red (TikTok, Instagram feed,
cuadrado, YouTube, Facebook). Al final, un solo MP4.

Las cuatro animaciones están elegidas porque ffmpeg las reproduce igual que la
vista previa, con etiquetas ASS (`\fad`, `\move`, `\t`), en vez de aproximarlas.

El detalle completo —incluida la lista de lo que este editor todavía **no**
hace— está en [`docs/editor.md`](docs/editor.md).

## Comprobar que todo funciona

En **Ajustes → Probar todo**. Llama de verdad a cada servicio con la petición
más barata que demuestre que la clave sirve —listar modelos, una búsqueda de un
resultado—, así que no genera guiones ni voz y no gasta cuota apreciable.

Comprueba la base de datos, Redis, ffmpeg, ffprobe, que se puede escribir en el
volumen, las cuatro claves de IA (y si el modelo configurado existe de verdad en
la lista del proveedor), los modelos de voz, Pexels, Pixabay, TikTok y Reddit.

Cada prueba tiene 15 segundos de margen: un servicio que no contesta sale como
fallo, no deja la página colgada. Los mensajes de error nunca incluyen la clave,
solo el código de respuesta y una pista cuando es un 401 o un 403.

También está en `GET /api/diagnostico` y como herramienta del servidor MCP.

## Audio y vídeo por separado

El vídeo y la voz ya no van forzosamente juntos. Cada serie —y cada historia
del editor— elige su **modo de audio**:

| Modo | Qué hace | Duración de cada escena |
|---|---|---|
| `VOZ` | Narración generada, como siempre | La que dure su audio |
| `MUSICA` | Sin narración: subtítulos y música de fondo | La que cueste leer el texto |
| `MUDO` | Sin sonido, solo subtítulos | La que cueste leer el texto |

En `MUSICA` y `MUDO` **el paso de voz se salta entero**, así que no se gasta
nada de cuota de TTS y la historia se produce bastante más rápido.

Cuando no hay voz, la duración sale del texto: unas 2,2 palabras por segundo de
lectura más un segundo de margen, acotado entre 2,5 y 10 segundos. Si prefieres
un ritmo fijo, pon los segundos por escena en la serie o en el editor. Y el
guion se pide distinto: frases más cortas, porque se leen en pantalla en vez de
escucharse.

En `MUSICA` la pista no se agacha —no hay voz que dejar pasar— y suena al 80 %.
En `MUDO` se añade una pista de silencio en lugar de dejar el MP4 sin audio,
que da menos problemas de compatibilidad.

## El guion como texto, para llevarlo a otra IA

Para que el proceso no sea del todo automático, el guion se puede sacar como
texto plano, pasarlo por otra IA o reescribirlo a mano, y volver a meterlo:

```
TITULO: Lo que nadie te dice
GANCHO: Nadie te avisa de esto a los veinte
HASHTAGS: reflexion, vida

--- Escena 1
A los veinte crees que el tiempo sobra.
CLIPS: city night, walking
```

En el editor, **Guion como texto → Abrir**: hay un botón para copiarlo y otro
para copiarlo con las instrucciones de formato ya puestas delante, para pegárselo
a cualquier modelo. *Aplicar este texto* lo convierte de vuelta y sustituye el
guion; a partir de ahí sigues con clips, voz y render como siempre. En la lista
de historias, *Copiar guion* hace lo mismo con una historia ya hecha.

El lector es tolerante: acepta mayúsculas o minúsculas, con acentos o sin ellos,
`CLIPS:`, `KEYWORDS:` o `PALABRAS:`, y separadores de tres guiones con o sin
rótulo. Lo que devuelva la otra IA se valida con el mismo esquema que el guion
generado aquí, así que un texto incompleto se rechaza con el motivo concreto
—qué línea falta o qué escena se quedó sin clips— en vez de colarse a medias.

## Elegir los clips a mano

Tras escribir el guion, el editor muestra una fila por escena —incluido el
gancho— con sus clips candidatos. Cada uno se ve como fotograma y se puede
reproducir con el botón *Ver* antes de decidir. Lo que no elijas queda en
automático.

Las vistas previas se reproducen **directamente desde el CDN de Pexels o
Pixabay**, los mismos dominios de los que el servidor ya descarga; por eso están
añadidos a `media-src` en la política de seguridad. El servidor solo se descarga
el clip que acabe usándose.

Del navegador nunca se acepta una URL de vídeo: se manda el **id** del clip y el
servidor lo resuelve contra su propia búsqueda, así que no hay forma de colar
una dirección arbitraria.

## Ver el vídeo antes de descargarlo

En la lista de historias, *Ver vídeo* lo reproduce dentro de la app. La ruta
`GET /api/historias/:id/ver` sirve el MP4 en línea y admite `Range`, así que el
reproductor puede saltar por el vídeo sin traérselo entero. Sigue protegida por
la sesión, igual que la descarga.

## Cómo llega el vídeo a TikTok y de dónde salen las métricas

Hay dos caminos, y el sistema de calificación funciona con los dos:

| | Subida por API | Subida manual |
|---|---|---|
| Cómo | La app envía el MP4 a borradores o lo publica directo | Descargas el MP4 y lo subes en TikTok Studio |
| Requisitos | App registrada, scope `video.upload` aprobado (y `video.publish` para publicación directa) | Nada |
| Vistas, likes, comentarios, compartidos | Automáticas, cada 6 h, si además tienes el scope `video.list` | A mano |
| Tiempo de permanencia | **No lo da la API**, a mano | A mano |

La parte importante: **TikTok no expone el tiempo medio de visualización por
API**. La Display API entrega `view_count`, `like_count`, `comment_count` y
`share_count`, pero la retención solo está en la analítica de TikTok Studio. Por
eso cada historia tiene un formulario de métricas donde ese dato se escribe a
mano; el resto se rellena solo cuando la subida fue por API.

Si subes a mano, todo el bloque se escribe a mano una vez por vídeo. Son treinta
segundos y es lo que alimenta la calificación.

## Calificación y reutilización

Cada historia publicada recibe una puntuación de 0 a 100:

```
retención   = permanencia media / duración           (si la has cargado)
interacción = (likes + comentarios + 2·compartidos + 2·guardados) / vistas
puntuación  = 100 · (0,6·retención + 0,4·min(interacción / 0,12 , 1))
```

Compartir y guardar pesan doble porque son las señales que más empujan el
alcance. Si no hay permanencia cargada, el peso de la retención pasa a la
interacción. Por debajo de **200 vistas no se puntúa**: la muestra es demasiado
pequeña y reutilizar por ruido es peor que no reutilizar.

Esa puntuación se promedia hacia la **idea** y hacia el **gancho** que
produjeron la historia. A partir de ahí:

- El programador elige idea del banco con un sorteo **ponderado por
  puntuación**: lo que funcionó sale más veces, pero lo nuevo se sigue probando.
- Un gancho con 60 puntos o más se reutiliza tal cual, con una probabilidad del
  35 %, en una historia nueva. El resto de las veces el modelo escribe uno nuevo.

Los umbrales están juntos y comentados en `src/servicios/banco.ts` y
`src/servicios/metricas.ts`.

## Banco de historias y ganchos

La pestaña **Banco** permite añadir ideas en lote (una por línea, o
`título | tema`), descartarlas, reactivarlas y ver la puntuación de cada una y
de cada gancho. El programador toma de ahí; si el banco está vacío, usa los
temas de la serie como antes.

El **gancho** ya no es la primera frase de la primera escena: es una escena
propia, con su clip, su audio y un estilo de subtítulo más grande y más alto
(`Style: Gancho` en `src/render/subtitulos.ts`). También encabeza la descripción
que se copia para TikTok.

La **música** puede fijarse o ponerse en modo *rotar*: en ese caso cada historia
elige la pista menos usada recientemente en esa serie.

## Servidor MCP

`node dist/mcp/servidor.js` levanta un servidor MCP por stdio que habla con la
API desplegada usando `API_TOKEN`. No abre ningún puerto nuevo en el servidor.

```json
{
  "mcpServers": {
    "estudio": {
      "command": "node",
      "args": ["/ruta/al/repo/dist/mcp/servidor.js"],
      "env": {
        "ESTUDIO_URL": "https://estudio.tudominio.com",
        "ESTUDIO_TOKEN": "el mismo valor que API_TOKEN"
      }
    }
  }
}
```

Herramientas disponibles: `catalogo`, `diagnostico`, `listar_series`,
`listar_historias`, `listar_categorias`, `plantear_historia`, `escribir_guion`,
`crear_historia`, `programar_subida`, `listar_ideas`, `agregar_ideas`,
`importar_musica_suno`, `crear_videoclip`, `momentos_cancion`, `crear_cortes`,
`rendimiento` y `sincronizar_metricas`. Con ellas puedes pedir
cosas como *"mira qué ganchos rindieron mejor este mes y prepárame tres
historias en inglés para el viernes"*.

`API_TOKEN` se genera con `openssl rand -hex 32` y se acepta como
`Authorization: Bearer`. Si lo dejas vacío, solo se entra con la cookie de
sesión y el servidor MCP no funciona.

## Reddit como detector de temas

Desactivado por defecto (`REDDIT_ACTIVO=false`). Cuando se activa, una tarea
diaria mira los *top* del día de los subreddits configurados en español e inglés
y deja los títulos en el banco como ideas pendientes.

**Solo se guardan título, subreddit, puntuación y enlace.** El cuerpo del post
no se descarga ni se almacena, y el guion lo escribe siempre el modelo desde
cero. Copiar un relato ajeno en un vídeo monetizado es un problema de derechos,
y TikTok además penaliza el contenido poco original.

Dos avisos que conviene tener presentes:

- El nivel gratuito de la API de Reddit es **para uso no comercial** (100
  consultas por minuto por client ID). Monetizar el canal es uso comercial y
  requiere un acuerdo previo con Reddit.
- Los subreddits por defecto son un punto de partida; ajústalos en
  `REDDIT_SUBS_ES` y `REDDIT_SUBS_EN` a los que de verdad te sirvan.

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

**Cómo se conecta la cuenta, qué permisos hace falta pedir y qué tipo de cuenta
sirve: [`docs/tiktok.md`](docs/tiktok.md).**

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

### Desde un enlace de Suno

Para la música de ambiente puedes pegar el enlace de una canción de Suno
(`https://suno.com/song/<id>`): en el selector de música de Crear y Series hay
un campo *Música desde Suno*, y en el editor de montaje otro en la pestaña
Música. La app saca el id del enlace, descarga el audio **solo desde el CDN de
Suno** (nunca sigue una URL arbitraria), comprueba con ffprobe que es audio y
lo guarda como `suno-<id>.mp3`: en `/data/musica` (biblioteca compartida, sirve
para rotar en las series) o dentro del proyecto si se añade desde el editor.
También por API: `POST /api/musica/enlace { url }` y
`POST /api/proyectos/:id/musica-enlace { url }`, o la herramienta MCP
`importar_musica_suno`.

De ese nombre de archivo sale el crédito, que se añade solo a la descripción y
a los metadatos del MP4: `Música: Suno — https://suno.com/song/<id>`. Usa
canciones tuyas: en el plan gratuito de Suno son de uso no comercial, y en los
de pago la licencia es tuya. Si Suno no deja descargar una canción (privada o
borrada), la app lo dice y puedes descargarla desde Suno y subirla como
archivo.

## Videoclips musicales

El mismo editor sirve para hacer el vídeo de una canción. Cambia quién manda:
en una historia manda la narración, en un videoclip manda la **música**. No hay
voz en off, la canción suena entera y decide cuánto dura el vídeo.

Pestaña **Música**:

1. **La canción**: un enlace de Suno (se descarga al proyecto) o una pista de
   la biblioteca. También puedes subir tu propio archivo desde el editor.
2. **La letra**, pegada tal cual. Si trae etiquetas al estilo de Suno
   (`[Verso 1]`, `[Coro]`, `[Puente]`), se respetan como tramos; si no, se
   agrupa por estrofas. Puedes elegir si la letra se ve en pantalla o no.
3. **Instrumental**: sin letra, escribes tú los **lineamientos** («paisajes de
   montaña al amanecer, niebla, cámara lenta, nada de ciudad») y de ahí salen
   los criterios de búsqueda.
4. **Lineamientos de imagen** (opcional con letra): ambiente, colores, qué
   evitar. Mandan sobre lo que diga la letra.

Con eso, el montaje se arma solo: cada tramo de la canción busca sus propios
clips en inglés, los planos cortan más rápido en el coro y más lento en la
intro, y la letra se coloca donde le toca. Después se edita como cualquier otro
montaje: mover clips, cambiar textos, sustituir un vídeo que no encaje.

El análisis de la letra lo hace el motor de IA configurado. Si no hay ninguno,
el reparto se hace por etiquetas y estrofas y las palabras largas de cada tramo
hacen de criterio de búsqueda: el videoclip sale igual, solo que menos fino.

### Cortes y formatos para redes

En el editor, pestaña **Cortes**: del MISMO montaje salen varias salidas, cada
una con su tramo y su formato, y cada una se renderiza y se descarga aparte sin
tocar el MP4 principal.

- **Paquete para redes** deja encoladas tres de golpe: la completa en 16:9 para
  YouTube, la completa en vertical y el corte de 30 segundos del mejor momento.
- **Buscar los mejores momentos** analiza la propia canción: mide el nivel
  segundo a segundo y propone las ventanas con más fuerza, porque el estribillo
  casi siempre es la parte más llena. Si la letra marca el coro, ese tramo
  puntúa más alto y el corte sale de ahí.
- También puedes fijar a mano el segundo de inicio, la duración y el formato.

Un corte no es un recorte del MP4 ya hecho: se vuelve a renderizar desde los
clips originales, así que el 16:9 y el 9:16 salen bien encuadrados los dos, y
la música arranca en el segundo que le toca, no desde el principio.

Los cortes se descargan desde la misma pestaña, y comparten los créditos del
montaje (clips y canción).

## Licencia de los clips

Cada escena guarda la fuente, el autor, la página y la licencia del clip, y la
descripción que genera la app los incluye. Pixabay exige cachear sus resultados
24 horas y alojar los archivos en tu servidor: las dos cosas están implementadas
en `src/servicios/clips.ts`, junto con una lista blanca de dominios que evita
que una URL manipulada haga que el servidor acceda a direcciones internas.
