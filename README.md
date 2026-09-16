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
- **Dos áreas de contenido.** Historias de ficción por género, y **ideas**:
  literatura clásica, premios Nobel, filosofía, política y poder, economía,
  negocios y estafas contadas para reconocerlas.
- **Miniseries.** Una historia larga planeada de golpe en capítulos, cada uno
  con su corte final, y dos formatos largos (hasta 15 min) para publicarlos.
- **Bancos de imagen a elegir.** Pexels, Pixabay y la **NASA** (dominio público,
  sin clave, la buena para ciencia y espacio), con vídeo, fotos o las dos cosas;
  las fotos se animan solas para que parezcan vídeo.
- **Galería.** Biblioteca propia de vídeo y foto: se sube, se guarda de los
  bancos y se compone un montaje con lo elegido, en el orden elegido.
- **Diálogos.** Dos o tres voces distintas discutiendo un tema, con el rótulo
  del que habla en su color.
- **Remix de canciones.** La misma letra escrita en otros ritmos —cumbia,
  drill, huayño, saya, bachata…— con las cajas de Suno listas para copiar y el
  gancho de los primeros quince segundos.
- **Productos con reflexión.** Un objeto real de Amazon como gancho y un giro
  final que habla de nosotros: enlace de afiliado y divulgación siempre en la
  descripción, y fotos solo si hay API oficial.
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
├── servicios/            guion, voz, clips, medios y TikTok
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
`PIXABAY_API_KEY`, `OPENVERSE_TOKEN`, `AMAZON_ACCESS_KEY`, `AMAZON_SECRET_KEY`,
`TIKTOK_CLIENT_KEY` y `TIKTOK_CLIENT_SECRET`. Si una falla al
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

### Si la voz de Gemini falla

Google renombra los modelos de síntesis cada pocos meses. La app pregunta a la
API cuáles tiene tu clave y usa el que haya: si `GEMINI_MODELO_VOZ` apunta a uno
que ya no existe, lo detecta y sigue con otro en vez de fallar. Cuando no hay
ninguno, el mensaje dice qué modelos tienes disponibles.

El selector de voz del editor lista esos modelos en lugar de pedirte el nombre a
mano, y la comprobación de Ajustes **sintetiza una palabra de verdad** en lugar
de limitarse a comprobar que el modelo existe.

Las marcas de tono (`[pausa]`, `[susurrando]`, `[con énfasis]`…) no se leen en
alto: con Gemini se convierten en una indicación de estilo delante del texto, y
con las demás voces se quitan.

### Una petición de voz cada vez

Las llamadas al sintetizador van **de una en una por proveedor**, encoladas, con
un cuarto de segundo de respiro entre una y la siguiente: nunca hay dos
peticiones en el aire a la vez, que es lo que disparaba los errores de cuota y
dejaba archivos a medias. Los reintentos esperan su turno igual que la primera
llamada.

El audio se guarda con el nombre de **la huella de su texto y su voz**
(`voz-<huella>.wav`, con un `.json` al lado donde van los tiempos de cada
frase), y se publica renombrando el temporal: o está entero, o no está. Pedir
dos veces la misma narración no gasta cuota —se devuelve el archivo que ya
existe—, y si la API falla, el proyecto se queda con la narración anterior en
vez de con medio archivo. Para volver a pedirla de verdad está el botón *Pedirla
otra vez* (`{"forzar": true}` en `POST /api/proyectos/:id/voz`).

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

## Peso del vídeo: cuánto va a ocupar y cómo bajarlo

El tamaño de un MP4 es, con poca variación, **bitrate × duración**. Por eso el
editor lo dice **antes** de renderizar, en la pestaña Formato y bajo la vista
previa: duración, resolución real y los megas aproximados.

Hay tres perfiles de compresión:

| Calidad | Resolución | CRF / audio | 3:30 min | 15 min |
| --- | --- | --- | --- | --- |
| Alta | la del formato | 20 / 192 kbps | ≈ 154 MB | ≈ 661 MB |
| Normal (por defecto) | la del formato | 23 / 128 kbps | ≈ 103 MB | ≈ 441 MB |
| Ligera | 720p a 24 fps | 26 / 96 kbps | ≈ 27 MB | ≈ 117 MB |

Las cifras son para vertical 1080×1920 con material de archivo normal; un
vídeo de planos quietos pesa bastante menos. La estimación **se corrige sola**:
cada render guarda lo que pesó de verdad y, a partir del segundo, la cuenta usa
tu propio historial para ese formato y esa calidad (lo marca como «medido»).

Tres cosas más que evitan llenar el disco:

- **Techo de bitrate.** Si por la cuenta el archivo no cabe en `MAX_VIDEO_MB`,
  el codificador recibe un techo (VBV) para que quepa, en vez de tardar diez
  minutos y fallar al final por tamaño.
- **Cada clip se descarga una vez.** En un videoclip largo el mismo vídeo de
  archivo aparece muchas veces en la línea de tiempo; antes se bajaba una vez
  por aparición. Ahora se reutiliza, que ahorra descargas y disco temporal.
- **Limpieza diaria.** Los MP4 se borran pasados `RETENCION_DIAS` días y las
  carpetas de trabajo, al terminar cada render.

La calidad se elige por proyecto (pestaña Formato) y también por corte, así que
puedes dejar la versión completa en normal y sacar los cortes de 30 segundos en
ligera. Ten en cuenta que TikTok, YouTube e Instagram recomprimen el vídeo al
subirlo: pasar de «normal» a «alta» casi nunca se nota en la red, y duplica el
archivo.

## Límites de tamaño

| Variable | Por defecto | Qué hace |
|---|---|---|
| `MAX_CLIP_MB` | 150 | Corta la descarga de un clip que se pase, por cabecera y por bytes recibidos. |
| `MAX_VIDEO_MB` | 300 | Si el MP4 compilado se pasa, la historia queda en `ERROR` con el tamaño real y el límite en el mensaje. También se comprueba antes de subir a TikTok. |

Los dos límites se muestran en el editor para que no haya sorpresas.

## Qué motor escribe: Groq por defecto, y lo que hay si no

El motor del guion se elige en cada pantalla (Editor, Series, Diálogo) y
arranca en **Groq** si tiene clave —es el rápido y barato para historias—; si
no, en el primero que la tenga, en este orden: Groq, Gemini, OpenAI, Claude.

Si el motor elegido **no tiene clave o se cae** (cuota, red, modelo retirado),
no se pierde el trabajo: se sigue con los demás que sí la tengan, en ese mismo
orden, y el resultado dice quién escribió de verdad
(`motorUsado`) y por qué (`avisoMotor`), que es lo que se ve en pantalla:
«Escrito con gemini (gemini-2.5-flash) porque groq falló: Groq respondió 429».

- Un modelo escrito a mano se aplica **solo al motor pedido**; al sustituto se
  le deja el suyo, que es el que sabe servir.
- El selector dice qué motores tienen clave, y si no hay ninguno lo avisa con
  todas las letras en vez de fallar al generar.
- Vale igual para historias, segundas partes, miniseries y **diálogos**: el
  diálogo se puede escribir con Gemini o con el que esté disponible.

## Modelos: Google AI Studio y el resto

Los proveedores renuevan sus modelos a menudo, así que los nombres se
configuran en el entorno y se pueden afinar sin tocar el código:

| Variable | Para qué |
|---|---|
| `GEMINI_MODELO` | Historias con Google AI Studio |
| `GEMINI_MODELO_VOZ` / `GEMINI_VOZ` | Voz con Google AI Studio (el modelo es una preferencia: si tu clave no lo tiene, se usa el que sí) |
| `ANTHROPIC_MODELO`, `OPENAI_MODELO`, `GROQ_MODELO` | Historias con los otros motores |
| `OPENAI_MODELO_VOZ` / `OPENAI_VOZ` | Voz con OpenAI |

Sobre esa base, el editor y cada serie pueden fijar su propio modelo de
historia y su propia voz, de modo que puedes combinar, por ejemplo, historias
con `gemini-2.5-flash` y voz con el modelo TTS de Gemini, o historia con Gemini
y voz con OpenAI. Si dejas el campo vacío se usa el valor del entorno.

## Términos y privacidad: las dos páginas que piden las plataformas

TikTok (y Amazon, y cualquier plataforma seria) no aprueba una aplicación sin una
**Terms of Service URL** y una **Privacy Policy URL** públicas en tu dominio. La
app las sirve ella misma, sin login, en `/terminos` (`/terms`) y `/privacidad`
(`/privacy`), en español y con la traducción al inglés debajo.

Rellena antes quién firma:

```
LEGAL_TITULAR=Tu nombre o el de tu empresa
LEGAL_CONTACTO=tu-correo@tu-dominio
LEGAL_JURISDICCION=Bolivia
```

Sin esos datos las páginas salen con un aviso rojo diciendo que no identifican a
nadie. La comprobación **Términos y privacidad** de Ajustes avisa de eso y
enseña las dos direcciones listas para pegar.

Los textos cuentan lo que la app hace de verdad: contraseñas con argon2id,
sesión en cookie propia de 7 días, testigos de TikTok cifrados con AES-256-GCM y
borrados al desconectar, métricas agregadas del vídeo (nunca de quien lo ve),
MP4 borrados a los `RETENCION_DIAS` días, y la lista de con quién se habla
(motores de IA, bancos de imagen, Amazon y TikTok). Si cambias ese
comportamiento, cambia `src/rutas/legales.ts` y su fecha de revisión.

## Créditos para TikTok

Cada escena guarda el clip que usó (id, fuente, autor, página y licencia). La
**descripción para publicar** es corta a propósito, porque en TikTok cada
carácter cuenta: el **gancho viral**, el gancho del vídeo, hasta seis hashtags,
los créditos agrupados por fuente en una sola línea (`Clips: Pexels (Ana, Luis)
· Pixabay (Pedro)`), la música si es de Suno y el aviso de contenido creado con
IA.

```
Nadie sabe a dónde va el tren de las 3:14
Nadie te contó lo de la casa del fondo.
#terror #casaembrujada #miedo
Clips: Pexels (Ana, Luis) · Pixabay (Pedro)
Música: Suno — https://suno.com/song/1f6a0b0e-…
Contenido creado con IA.
```

La primera línea es lo único que se ve antes del «ver más», así que ahí va un
**gancho escrito para leer**, no el narrado. El guion genera tres, cada uno con
un ángulo distinto (una pregunta que pica, un dato que descoloca, una promesa
concreta), sin emojis y sin pedir like: el primero encabeza la descripción y los
otros quedan guardados para probar cuál rinde. Se editan en el editor (*Ganchos
para la descripción*, uno por línea) y en la lista de Historias aparecen como
botones que los copian sueltos.

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

Las categorías van en **dos áreas**, porque no se escriben igual:

**Historias** (ficción): comedia, drama, terror, historia real, triunfo y
superación, engaño y traición, misterio, romance, aventura, reflexión, ciencia y
curiosidades y crimen; cada una con sus subcategorías (por ejemplo terror › casa
embrujada, carretera de noche, leyenda urbana, tecnología, bosque, ritual).

**Ideas y pensamiento**: cortos de una idea grande, no de una trama inventada.

| Categoría | De qué van | Líneas (subcategorías) |
|---|---|---|
| **Literatura clásica** | la idea que sostiene un libro, para quien no lo ha leído | clásicos universales, novela rusa, latinoamericana, tragedia griega y mito, distopías, poesía, personajes |
| **Premios Nobel** | una idea o una vida premiada, y qué queda de ella | Nobel de Literatura, discursos de aceptación, Nobel latinoamericanos, Nobel de la Paz, Nobel de ciencia, los que dijeron que no |
| **Filosofía** | una idea filosófica con un ejemplo de hoy | estoicismo, existencialismo, el absurdo, ética y dilemas, verdad y conocimiento, sospecha y crítica, pensamiento oriental, filosofía y tecnología |
| **Política y poder** | cómo se consigue, se conserva y se pierde el poder | estrategia y Maquiavelo, propaganda, totalitarismo y libertad, democracia y sus grietas, revoluciones, caídas del poder, imperios |
| **Economía** | precios, deudas, crisis e incentivos, sin jerga | burbujas y crisis, dinero e inflación, incentivos, desigualdad, trabajo y salarios, teoría de juegos, deuda |
| **Negocios y estrategia** | una decisión de negocio y sus consecuencias | fracasos famosos, modelos de negocio, fundadores, competencia y monopolio, marketing y persuasión, precios, negocio pequeño |
| **Trampas y estafas** | cómo funciona un engaño **para reconocerlo a tiempo** | pirámides y Ponzi, inversiones milagro, suplantación y phishing, estafa romántica, letra pequeña, ofertas de trabajo falsas, por qué caemos, trampas legales pero sucias |

Un vídeo de ideas no se escribe como un cuento. El planteamiento pide además
**de dónde sale la idea** (obra, autor, corriente o caso) y **cuál es**, en una
frase; y el guion sigue una estructura fija: gancho, el problema con un ejemplo
cotidiano, la idea y de quién es, la objeción más seria, qué cambia si te la
tomas en serio y un cierre. Como mucho una cita textual breve y con su autor:
el resto va parafraseado, porque los modelos inventan citas con demasiada
facilidad.

Cada categoría de ideas lleva sus **reglas**, que van al prompt tal cual y
marcan el límite del género. Las de *Trampas y estafas* son las más estrictas a
propósito: se cuenta desde quien lo sufre o desde quien lo destapa, nunca desde
quien lo monta; está prohibido dar pasos, guiones o plantillas que sirvan para
ejecutar el engaño; los nombres son inventados; y cada vídeo termina con la
señal de alarma concreta y qué hacer. Es material para no caer, no un manual.
En la misma línea, economía no da consejos de inversión, negocios no promete
ingresos y política no habla de partidos ni gobiernos actuales.

Para que el sorteo no saque siempre lo mismo, cada categoría de ideas tiene una
lista de **fuentes** (de Epicteto a Byung-Chul Han, de la burbuja de los
tulipanes a Kodak) y en cada planteamiento se barajan unas cuantas como punto de
partida.

Todo está en `src/servicios/categorias.ts`, con el tono de cada género, las
reglas, las fuentes, palabras visuales en inglés para buscar clips y hashtags
cortos. La lista llega al frontend en `GET /api/catalogo` (`categorias` y
`areas`).

Dónde se usa:

- **Editor** (pestaña Crear): selector de categoría y subcategoría agrupado por
  área, con la pista de cada subcategoría debajo; botón *Plantear al azar
  (título y lineamientos)* que muestra el planteamiento para revisarlo o
  cambiarlo (título, lineamientos, giro, criterios de clips, y en ideas también
  la fuente y la idea), y después *Escribir guion con este planteamiento*. Sin
  categoría se escribe directo, como antes.
- **Series**: categoría fija, *al azar una distinta cada vez* (de todo o solo
  dentro de un área, con `aleatoria:ideas` o `aleatoria:ficcion`) o sin
  categoría.
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

## Miniseries y formato largo

Una **miniserie** se planea entera antes de escribir nada: título, sinopsis,
personajes y qué pasa en cada capítulo, con el corte en el que termina. Después
cada capítulo se escribe por separado sabiendo dónde cortó el anterior —lo
recuerda en una frase y sigue— y el último cierra la historia del todo, sin
dejar nada abierto ni anunciar continuación.

No es lo mismo que *continuar una historia*, donde cada parte se improvisa sobre
la anterior: aquí el plan existe desde el principio, así que los capítulos no se
contradicen ni repiten.

- **Editor**: *Planear miniserie (formato largo)* con el número de capítulos
  (2 a 12). El plan se ve entero, se elige qué capítulo toca y se escribe con el
  botón de siempre; producir cada capítulo es como producir cualquier historia.
- **Formatos largos**: *Vertical largo (9:16, miniserie)* y *YouTube largo
  (16:9, miniserie)*, hasta **15 minutos** por vídeo; el resto sigue con el tope
  de 350 s. Un vídeo largo pesa mucho: la calidad *ligera* (720p) es la que
  tiene sentido ahí, y el estimador de tamaño avisa antes de renderizar.
- **API**: `POST /api/miniserie` devuelve el plan; `POST /api/guion` y
  `POST /api/historias` aceptan `miniserie` y `capitulo`.
- **MCP**: `plantear_miniserie`, y `miniserie` + `capitulo` en `escribir_guion`
  y `crear_historia`.

## De dónde salen las imágenes

Tres bancos, y se eligen a mano o los elige la categoría:

| Banco | Qué tiene | Clave |
|---|---|---|
| **Pexels** | vídeos y fotos verticales de todo | `PEXELS_API_KEY` |
| **Pixabay** | vídeos y fotos verticales de todo | `PIXABAY_API_KEY` |
| **NASA** | espacio, planetas, misiones y la Tierra desde fuera; **dominio público** | ninguna |
| **Openverse** | cientos de millones de fotos con licencia libre (Flickr, museos, archivos) | ninguna |
| **Wikimedia Commons** | retratos, cuadros, mapas, primeras ediciones y archivo histórico; también vídeo | ninguna |
| **Internet Archive** | cine y noticiarios de dominio público: material de archivo de verdad | ninguna |

La NASA (images.nasa.gov) no pide clave y su material es de dominio público, así
que los **cuentos de ciencia** la usan por defecto: la categoría *Ciencia y
curiosidades* busca ahí antes que en los bancos genéricos, y admite fotos además
de vídeos. Se acredita como «NASA/JPL (NASA, Dominio público (NASA))». Ojo: no
todo su material es limpio, hay vídeos con rótulos o logotipos quemados; por eso
conviene mirarlos en el buscador antes de dejarlos.

Las categorías del área de ideas también admiten fotos (estatuas, libros,
archivo), que es donde más las hay, y buscan en **Commons y Openverse** antes
que en los bancos de vídeo comercial: un retrato de Marie Curie o un grabado de
Goya está ahí, no en Pexels. *Historia real* y *crimen* miran además a
**Internet Archive**, que es donde están los noticiarios.

### Las licencias no son todas iguales

Los tres bancos abiertos traen la licencia de cada pieza y la app la guarda y la
acredita: `Andrea Luck (Wikimedia Commons, CC BY 2.0) - https://…`. Conviene
mirarla antes de usar algo, porque no obligan a lo mismo:

- **CC0 / dominio público**: sin condiciones. Es lo que da la NASA y buena parte
  de Internet Archive.
- **CC BY**: hay que acreditar, y la app ya lo hace.
- **CC BY-SA**: además de acreditar, obliga a publicar **el vídeo resultante con
  esa misma licencia**. Si eso no encaja con lo que vas a hacer, elige otra
  pieza; la licencia se ve en cada resultado de la búsqueda.

De Openverse solo se piden las que permiten **uso comercial y modificación**
(`license_type=commercial,modification`): lo que sale de ahí se recorta, se
anima y se publica, así que una "no comercial" no serviría.

Openverse sin registrarse deja 20 peticiones por minuto y 200 al día; con la
caché de un día llega de sobra para buscar a mano, y `OPENVERSE_TOKEN` sube ese
límite si hace falta. Wikimedia e Internet Archive no piden nada, pero sí que la
app se identifique, así que todas las peticiones y descargas van con su
`User-Agent`.

### Descargar de sitios que no están en la lista

Los bancos conocidos sirven desde dominios fijos y ahí la lista blanca basta.
Openverse es distinto: indexa Flickr, museos y archivos, así que el archivo
final puede estar en cualquier sitio. Para esos casos la comprobación es otra:
solo https, se resuelve el dominio y **se rechaza lo que apunte a la red
interna** (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x —los metadatos de la
nube—, CGNAT y las equivalentes en IPv6), se revisa cada redirección igual, y lo
que llega tiene que ser del tipo que se pidió: una página de error HTML no puede
acabar guardada como si fuera una foto.

Se elige en tres sitios, y siempre gana lo que se marque a mano:

- **Editor** y **Series**: *Dónde buscar la imagen* (casillas por banco) y *Qué
  admitir* (vídeos, fotos). Vacío = lo que use la categoría.
- **Montaje**: el buscador de clips lleva las mismas casillas más *incluir
  fotos*, para elegir plano a plano.
- **API**: `bancos` y `medios` en `POST /api/historias` y en las series;
  `GET /api/clips?bancos=nasa&medios=video,imagen` para buscar.

### Las fotos se mueven

Una foto quieta en un vídeo vertical parece un fallo del reproductor, así que
**toda foto se anima**: se amplía al doble del lienzo y se recorre con
`zoompan`, de donde salen cinco movimientos —acercar, alejar, paneo a la
derecha, paneo a la izquierda y Ken Burns (zoom y paneo a la vez)—. Las fotos
seguidas reciben movimientos distintos para que no se note el truco, y si eliges
un efecto que no mueve nada (blanco y negro, viñeta) se le pone un Ken Burns
debajo. La vista previa del editor hace lo mismo con CSS, así que lo que se ve
antes de renderizar es lo que sale.

## Galería: vídeo y foto propios

La pestaña **Galería** es el material, separado de las historias: se sube, se
guarda de los bancos y se compone con ello.

- **Subir**: vídeos (mp4, mov, m4v, webm) y fotos (jpg, png, webp), varios a la
  vez. El nombre del archivo lo pone el servidor y el contenido se comprueba con
  **ffprobe**: la extensión sola no prueba nada, y un `.mp4` que no es un vídeo
  se rechaza y se borra.
- **Guardar de los bancos**: el buscador (Pexels, Pixabay, NASA) lleva un botón
  *Guardar* que se trae el archivo a la biblioteca con su autor y su licencia,
  para que el crédito siga siendo correcto. Del navegador solo llega el id: el
  enlace se resuelve en el servidor contra la misma búsqueda.
- **Componer**: se eligen varios en el orden que se quiera —el número aparece en
  cada uno— y se elige el formato y cuántos segundos dura cada foto. Sale un
  **proyecto de montaje**, no un MP4: se abre en el editor de siempre, donde
  están la duración de cada plano, los textos, la voz y la música.

Las fotos entran con movimiento (acercar, alejar, paneo, Ken Burns, uno distinto
por foto seguida) y los vídeos con su duración real, acotada a 12 s por plano
para que no se coma el montaje. El material propio no lleva línea de créditos:
lo guardado de un banco sí conserva la suya.

El render de un clip de la biblioteca **no descarga nada**: el archivo ya está
en disco y se copia a la carpeta de trabajo.

La galería también está **dentro del editor de montaje**: en el panel Clip,
*Añadir de la galería* abre la misma rejilla y mete lo elegido en la línea de
tiempo, detrás del clip actual o al final, sin salir del editor.

### Si un banco no trae nada

Cada búsqueda dice **qué hizo cada banco**: cuántos resultados trajo y, si
falló, el motivo tal cual lo da el proveedor —`pixabay: 0 — Pixabay respondió
400: [ERROR 400] Invalid or missing API key`—. Antes cada banco fallaba en
silencio y la pantalla quedaba vacía sin explicación, que es lo peor que puede
pasar aquí: no se sabe si no hay material, si la clave está mal o si el banco
devolvió un 429.

Dos cosas más que iban en la misma dirección:

- **Un fallo ya no se queda cacheado un día.** Los resultados se guardan 24 h
  (Pixabay lo exige), pero si algún banco falló se guardan solo 5 minutos: un
  429 pasajero dejaba la búsqueda vacía hasta el día siguiente.
- **Pixabay sirve parte de su material desde `videos.pixabay.com` y
  `i.vimeocdn.com`** (sus entradas antiguas). Faltaban en la lista de dominios
  permitidos, así que sus resultados aparecían sin muestra o no se podían
  descargar.

En **Ajustes → Probar todo**, la prueba de Pixabay consulta sus **dos** APIs
—vídeo y foto, que fallan por separado—, cuenta los resultados de cada una y
dice desde qué dominio sirve el primero.

### Las miniaturas pasan por la app

Las muestras de los bancos ya no se enlazan directamente al CDN: van por
`GET /api/muestra?url=…`, que solo acepta https, solo los dominios de los
bancos y solo imágenes. Enlazar al CDN se cae por muchos sitios —la política de
contenido del navegador, redes que bloquean terceros, CDN sin enlazado
externo—, y era justo lo que hacía que **las fotos de la NASA no cargaran**
aunque la búsqueda funcionase.

Eso trajo un segundo problema, que también está resuelto: al pasar por la app,
las miniaturas empezaron a contar contra el **límite general de peticiones**
(120 por minuto). Una rejilla pide veinte de golpe, así que el cupo se agotaba
solo y las imágenes dejaban de cargar —otra vez en silencio—. Las rutas de
muestra (`/api/muestra`, `/api/medios/:id/miniatura`, `/api/medios/:id/ver`)
tienen ahora su propio límite, holgado, y se cachean un día en el navegador.

Y cuando una muestra no carga, **se ve que no cargó**: en su hueco aparece «no
se pudo cargar la muestra» en vez de un recuadro vacío.

### Si las imágenes de un banco siguen sin verse

En **Ajustes → Probar todo** hay dos comprobaciones para esto:

- **Política de contenido**: enseña los dominios de imagen que permite el
  servidor que está corriendo ahora mismo. Si `images-assets.nasa.gov` no
  aparece en la lista, lo que está desplegado es una versión anterior: hay que
  reconstruir y volver a desplegar (y recargar el navegador sin caché, porque
  la cabecera viaja con la página).
- **NASA (imágenes y vídeo)**: busca de verdad, saca la muestra de la primera
  ficha y la descarga, que es el mismo camino que recorre la pantalla. Si esa
  prueba pasa y aun así no se ven, el problema está entre el navegador y la
  app, no en la NASA.

## Diálogos: dos o tres voces sobre un tema

La pestaña **Diálogo** hace conversaciones, no narraciones: dos o tres personas
discutiendo un tema, cada una con **su propia voz**.

1. **Quién habla.** De dos a tres voces, cada una con su nombre, su postura (o
   se la inventa la IA), su voz —local, Gemini u OpenAI— y su color de rótulo.
   Arrancan con voces distintas a propósito: dos voces iguales suenan a la misma
   persona hablando sola, y si se repiten, se avisa.
2. **Escribir el diálogo.** El modelo escribe la conversación con turnos cortos,
   sin saludos ni presentaciones, empezando por el medio de la discusión, con
   **desacuerdo real** y sin que nadie convenza del todo al otro. Se lee entera
   y se corrige: cambiar quién dice qué, reordenar, reescribir o borrar
   intervenciones. Corregir una réplica sale mucho más barato que rehacer el
   vídeo.
3. **Crear el vídeo.** Cada intervención se sintetiza con la voz de quien habla
   (una petición cada vez, como toda la voz de la app), se pegan en orden con
   algo más de aire entre turnos que entre frases, y el rótulo de cada una sale
   con **el nombre y el color** de quien la dice. El resto es un montaje normal:
   se abre en el editor y de ahí al render.

La pista de voz guarda el diálogo entero (`modo: "dialogo"`, `hablantes`,
`dialogo`), y la huella que decide si hay que regenerar cubre las réplicas y las
voces: cambiar una coma obliga a rehacer el audio, y no cambiar nada no gasta
cuota.

- **API**: `POST /api/dialogo` escribe la conversación; `POST /api/dialogos` crea
  y monta el proyecto; `POST /api/proyectos/:id/dialogo` cambia las réplicas o
  las voces de uno ya creado y lo vuelve a montar.

## Productos de Amazon con reflexión detrás

La pestaña **Producto** hace vídeos que empiezan por un objeto real y acaban en
una idea. No es un anuncio: el producto es el gancho —lo que para el dedo— y lo
que se recuerda es el giro final. Si nadie compra nada, el vídeo sigue
funcionando.

1. **Qué producto.** Con la API de Afiliados se busca en Amazon y salen fotos,
   marca, características y precio del día. Sin ella se pega **el enlace del
   producto**: de ahí sale el ASIN, el mercado (`amazon.com.mx` → México) y el
   enlace con tu etiqueta.
2. **Cómo se cuenta.** El modelo escribe gancho, dos o tres momentos concretos
   del objeto en la vida de alguien, **qué no hace** (sin eso suena a anuncio) y
   la reflexión: qué dice de nosotros que ese objeto exista y lo queramos.
   No inventa precios, cifras ni materiales —solo puede dar por cierto lo que
   venga en la ficha—, no habla como si lo hubiera probado y no usa urgencia
   falsa. Se lee entero y se corrige antes de montar nada.
3. **Con qué imágenes.** Abre con la foto del producto (si vino de la API),
   siguen tus propias tomas de la galería en el orden que elijas, y el resto lo
   rellenan los bancos con el ambiente del guion. Lo que pongas delante se
   respeta tal cual; el relleno solo cubre lo que queda de narración.

**Lo que Amazon permite, y aquí se cumple.** Las fotos y los datos de un
producto solo pueden salir de la **Product Advertising API v5** con cuenta de
Afiliados aprobada; descargarlas de la ficha pública está prohibido, así que la
app no ofrece ninguna forma de hacerlo. Todo enlace lleva la etiqueta, y la
descripción lleva siempre la frase obligatoria:

```
Producto: Lámpara de escritorio con reloj despertador
https://www.amazon.es/dp/B0XXXXXXXX?tag=tuetiqueta-21&linkCode=ll1
Como Afiliado de Amazon, gano por las compras adscritas.
```

Eso no se guarda solo en el texto: el proyecto guarda **con qué se publica**
(gancho viral, etiquetas y producto) en la columna `publicacion`, así que cada
render vuelve a escribir el enlace y la divulgación en vez de borrarlos. El
precio se enseña como referencia del día y **nunca se narra**: cambia cada hora
y un vídeo dura meses.

- **Configuración**: `AMAZON_ACCESS_KEY`, `AMAZON_SECRET_KEY`,
  `AMAZON_PARTNER_TAG` y `AMAZON_MERCADO` (`com`, `es`, `com.mx`, `com.br`,
  `co.uk`, `de`, `fr`, `it`, `ca`). Solo con la etiqueta ya se pueden hacer
  enlaces; las dos claves son lo que abre las fotos y las fichas. La cuenta de
  Afiliados no abre la API hasta tener ventas: hasta entonces contesta que la
  clave no es válida, y eso sale tal cual en Ajustes › Comprobaciones.
- **API**: `GET /api/amazon` (qué se puede hacer ahora mismo),
  `POST /api/amazon/buscar`, `POST /api/amazon/producto` (enlace o ASIN → ficha),
  `POST /api/amazon/guardar` (sus fotos a la galería), `POST /api/producto`
  (escribe el guion), `POST /api/productos` (crea y monta el proyecto) y
  `POST /api/proyectos/:id/producto` (cambia o quita el producto de uno ya
  creado).

## Editor de montaje

La pestaña **Montaje** abre una línea de tiempo al estilo CapCut: se crea desde
una historia, desde una composición de la galería o desde un diálogo, con todo
ya colocado en orden, y desde ahí se cambia cada pieza. Texto con tamaño, color,
posición y cuatro animaciones; el clip de cada escena buscable por palabras o
traído de la galería; voz de IA, diálogo a varias voces o archivo propio; música
de la biblioteca o subida; y un preset de formato por red (TikTok, Instagram
feed, cuadrado, YouTube, Facebook, y los dos largos de miniserie). Al final, un
solo MP4.

Para componer con fotos, el panel **Clip** tiene lo que hace falta:

| Herramienta | Qué hace |
|---|---|
| **Duración y recorte** | cuánto dura el plano y por dónde entra; se estira arrastrando el borde en la línea de tiempo |
| **Efecto** | acercar, alejar, dos paneos, Ken Burns, fundido, blanco y negro, viñeta |
| **Encuadre** | *recortar* (llena el lienzo) o *ajustar* (cabe entera, con el fondo desenfocado detrás) |
| **Transición** | al clip siguiente: corte seco, fundido cruzado, desplazar, barrido o círculo, con su duración |
| **Añadir de la galería** | abre la biblioteca dentro del editor y mete lo elegido detrás del clip actual o al final |
| **Aplicar a todos** | la duración a todas las fotos, o el encuadre o la transición a todos los clips |

Las transiciones **no acortan el vídeo**: cada cruce sale a partes iguales de
los dos clips vecinos, así que el montaje sigue durando lo que dice la línea de
tiempo y la voz no se descoloca. Y cuando no hay ninguna transición se usa el
camino rápido de siempre, pegando sin recodificar.

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
`importar_musica_suno`, `crear_videoclip`, `sugerir_lineamientos`,
`unir_canciones`, `momentos_cancion`, `crear_cortes`, `rendimiento` y
`sincronizar_metricas`. Con ellas puedes pedir
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

### Subir una canción

En el selector de música de Crear, Series y Música hay un campo para **subir la
canción** a la biblioteca, y en el editor de montaje otro para subirla solo a
ese proyecto. Se aceptan mp3, m4a, wav, ogg, aac y flac hasta 80 MB; el nombre
lo limpia el servidor (sin tildes ni caracteres raros, numerado si ya existe) y
el archivo se comprueba con ffprobe antes de darlo por bueno.

Es la salida cuando Suno no deja descargar la canción: la bajas desde Suno y la
subes. Por API: `POST /api/musica/subir` (biblioteca) y
`POST /api/proyectos/:id/musica-archivo` (la deja puesta como música del
proyecto).

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
borrada), la app lo dice y la subes tú con «Subir un archivo»; en ese caso el
crédito de la canción lo pones a mano, porque el archivo ya no lleva el enlace.

## Remix: la misma canción en otros ritmos

La pestaña **Música** tiene dos mitades, y se cambia entre ellas con el submenú
de arriba: **Videoclip** monta el vídeo sobre una canción que ya existe, y
**Remix de canciones** escribe la canción, lista para pedírsela a Suno.

1. **La canción de partida.** Se pega la letra, o se deja vacía y se escribe
   solo de qué va. Lo primero que se pregunta es **de quién es la letra**, y no
   es burocracia: mira el recuadro de abajo.
2. **A qué ritmos.** Hasta seis de los 36 del catálogo, con los andinos y los
   latinos que Suno entiende bien: cumbia, cumbia villera, reggaetón, dembow,
   trap, drill, salsa, bachata, merengue, vallenato, **huayño, saya/caporal,
   morenada, cueca**, tango, ranchera, corrido tumbado, bolero, balada, pop,
   rock, punk, metal, R&B, afrobeats, amapiano, house, EDM, drum and bass,
   lo-fi, jazz, flamenco, country, K-pop, acústico y coral. Cada uno se escribe
   con su propia métrica: la misma idea no se canta igual en una cumbia que en
   un drill.
3. **Para el formato corto** (activado por defecto): la primera frase tiene que
   parar el dedo, el estribillo llega antes de los 15 segundos y hay una frase
   corta que se repite y se queda pegada.

De cada versión sale todo lo que pide Suno, listo para copiar caja por caja:

- la **letra** con sus etiquetas de sección (`[Verse]`, `[Chorus]`, `[Drop]`…),
- el **Style of Music** en inglés y por debajo de 200 caracteres (más largo se
  diluye y Suno deja de hacerte caso),
- el **Exclude styles**, el tempo y la tonalidad,
- cómo cantarla, **los 15 segundos que van en el corto** y por qué ese ritmo le
  sienta bien al tema,
- y los ganchos y hashtags para publicarlo.

Hay un botón para descargarlo **todo en un .txt** (una sección por versión) y
otro, **«Usar en un videoclip»**, que lleva esa letra a la otra mitad de la
pestaña: cuando Suno te dé la canción, pegas su enlace y el vídeo se monta solo.

> **Letra propia y letra ajena.** Reescribir la canción de otra persona es hacer
> una **obra derivada**, y eso necesita su permiso: no lo arregla cambiar el
> ritmo ni las palabras. Por eso el desplegable manda. Con *«es mía»* se
> reescribe, se recorta y se adapta con libertad. Con *«es de otro autor»* no se
> reescribe nada: de esa letra se toma solo el **tema** y se escribe una canción
> **original**, con imágenes y estribillos nuevos. Y como el modelo puede decir
> que escribió algo original y colar igualmente el estribillo, la respuesta se
> revisa: cualquier frase de seis palabras o más del original que aparezca tal
> cual —sin tildes ni puntuación, que es como se reconoce un verso aunque le
> cambien una coma— sale marcada en rojo para que la cambies antes de publicar.

- **API**: `GET /api/remix/ritmos` (catálogo e instrucciones de Suno),
  `POST /api/remix` (escribe las versiones; devuelve `calcos` con lo que haya
  que revisar) y `POST /api/remix/texto` (el .txt).

## Videoclips musicales

El mismo editor sirve para hacer el vídeo de una canción. Cambia quién manda:
en una historia manda la narración, en un videoclip manda la **música**. No hay
voz en off, la canción suena entera y decide cuánto dura el vídeo.

Pestaña **Música**:

1. **Las canciones**: una o varias, cada una de un enlace de Suno (se descarga
   al proyecto), de un archivo subido desde tu computadora o de la biblioteca.
   La subida es la salida cuando Suno no deja descargar la canción (privadas, o
   si cambia su descarga): la bajas desde Suno y la subes aquí.
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

**Varias canciones en un solo videoclip.** Suno entrega temas de dos o tres
minutos; en la lista de canciones puedes encadenar hasta ocho (enlaces de Suno,
pistas de la biblioteca o archivos subidos). Se mezclan en una sola pista con un
cruce suave configurable, y **cada canción lleva su propia letra**, así que la
segunda no hereda los tramos de la primera: en la línea de tiempo los tramos
salen como «Segunda canción · Coro». Los créditos listan todas. El tope de un
videoclip es más largo que el de las historias: 15 minutos por defecto,
configurable con `MAX_VIDEOCLIP_SEG`.

**La IA describe el videoclip por ti.** El botón *Proponer con IA*, en el
formulario y en la pestaña Letra, lee la letra (o solo el título) y devuelve
tres cosas: un párrafo de lineamientos en español (ambiente, paleta, tipo de
planos, qué evitar), las palabras de búsqueda de clips en inglés, y un **prompt
largo en inglés para generar imágenes** con la herramienta que uses. Lo propuesto
se puede corregir antes de guardar.

Además, cada tramo del montaje guarda su propio prompt de imagen. Desde la
pestaña Letra se copian todos o se bajan como `.txt`
(`GET /api/proyectos/:id/prompts.txt`), listos para pegarlos en un generador de
imágenes y sustituir después los clips de archivo por lo que generes.

**Todo lo que escribes se guarda en el proyecto** en cuanto lo creas, antes de
montar nada: la letra, los lineamientos, si es instrumental y si la letra se
quema en pantalla. Si subes la canción, el montaje arranca solo al terminar la
subida. Mientras se monta, el editor lo dice y se actualiza solo; no hay que
recargar.

Para cambiarlo luego está la pestaña **Letra** del editor: se ve y se edita la
letra, los lineamientos y los tramos que salieron de ellos, con dos botones,
*Guardar* (deja el montaje como está) y *Guardar y volver a montar* (rehace
tramos, clips y rótulos). Los cortes ya hechos no se tocan.

La **vista previa reproduce la canción** junto a los vídeos, así que se edita
oyendo lo que va a sonar, sin esperar al render.

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
