# Editor de montaje

Una línea de tiempo al estilo CapCut dentro de la app: se abre con el vídeo ya
montado y desde ahí se cambia pieza a pieza.

## Tres pistas sobre el mismo tiempo

El proyecto son **tres pistas independientes** sobre un único eje de tiempo,
como en CapCut. Nada obliga a que un texto coincida con un clip ni a que la
voz vaya al compás de ninguno de los dos.

| Pista | Qué contiene | Cómo se coloca |
|---|---|---|
| **Vídeo** | Clips en secuencia, cada uno con su duración, su segundo de entrada y su efecto | Uno detrás de otro; se añaden, se quitan, se buscan, se mueven |
| **Textos** | Rótulos con inicio y duración propios, estilo, animación y lectura | Donde quieras; pueden solaparse y no tienen por qué cuadrar con los clips |
| **Voz** | La narración entera como un solo texto, leída con **una sola voz** | En el instante que digas; su duración real la marca el audio generado |

Más la música de fondo, que se mezcla al final. La vista previa es un reloj
que recorre el proyecto: en cada instante enseña el clip que toca (con su
efecto según el progreso), los rótulos que caen encima y **la narración real
del servidor**, no una voz sintética del navegador.

Si la voz o los textos duran más que los clips, el último fotograma se congela
para cubrir el resto: nada se corta. El resumen bajo la vista previa lo avisa.

## Ensamblado automático: la narración manda

*Ensamblar con la narración* (barra superior) monta el proyecto en este orden,
que es el que pediste:

1. **La voz manda.** Se genera la narración con una sola voz —la mejor local
   disponible si no elegiste otra— **frase a frase**, y se mide cuánto ocupa
   cada frase en el audio final (con 0,28 s de silencio entre frases).
2. **El texto se acomoda a la voz.** Un rótulo por frase, colocado
   *exactamente* donde se lee; el primero, el gancho, más grande y centrado.
3. **El vídeo es la última capa.** Se rellena hasta la duración de la voz con
   clips al azar, **largos primero (30 s o más)**, cada uno con su duración
   real de origen y sin repetir mientras haya de dónde elegir. El primer clip
   es el gancho: 4 segundos con un plano llamativo (se busca con la primera
   frase más "cinematic").

Si la voz dura más que todos los clips disponibles, el conjunto se repite hasta
tres veces y, si aun así falta, se cierra con un fondo de color. Nada queda sin
imagen.

El cron en modo Montaje hace exactamente esto con cada historia que escribe.

## Duración real de los clips

Cuando se elige un clip —a mano, al azar o por parecido— **su duración es la
real del archivo en origen** (Pexels y Pixabay la devuelven), recortada al
hueco si es más largo. Después solo se puede **acortar**: el campo de duración,
el borde arrastrable y la división tienen como tope la duración de origen, que
se muestra junto al campo. Nunca se impone una duración más larga que el vídeo.

## Voces

La narración se lee con **una sola voz**. Las locales, de más robótica a más
natural, todas sin coste ni clave:

| Motor | Voces | Cómo suena |
|---|---|---|
| espeak-ng | `es-419`, `es`, `en-us` | Robótica, instantánea |
| Piper | `piper:es_MX-claude-high`, `piper:es_ES-davefx-medium` | Neural: la mejor sin pagar, ~0,7 s por frase. **Licencias Apache-2.0 y CC0: apta para uso comercial.** |
| MBROLA *(opcional, apagada)* | `mb-mx1`, `mb-mx2`, `mb-vz1`, `mb-es1`, `mb-es2` | Difonos: más natural que espeak, igual de rápida. **Non-free en Debian**: su licencia prohíbe venderla o incorporarla a un producto que se venda sin permiso. Se activa con `--build-arg CON_MBROLA=true`. |

El selector marca la calidad con estrellas y solo lista las que funcionan en
esa máquina; por defecto se usa la mejor disponible. Gemini y OpenAI siguen
ahí para cuando se quiera más. Verificado en este entorno: las tres familias
sintetizan, y Piper produce una frase de 15 palabras en 0,75 s.

## Ortografía, región y modismos

Los textos generados llevaban sin tildes, sin ñ y sin ¿¡ por una causa
concreta: los propios prompts estaban escritos así y el modelo copiaba el
estilo. Ahora todos los prompts están en español correcto y además incluyen
una regla explícita de ortografía (tildes, ñ, diéresis, signos de apertura y
cierre, mayúsculas).

Cada guion y cada narración se pide para una **región**:

| Región | Texto |
|---|---|
| **Bolivia** (por defecto) | Español de Bolivia con modismos y giros bolivianos naturales, sin caricaturizar |
| Latinoamérica | Español latinoamericano cercano, con expresiones comunes en toda la región |
| EE. UU. | Inglés de Estados Unidos |

Y con **modismos** o **neutro**: en neutro se pide español latinoamericano sin
regionalismos. Se elige en el editor, en cada serie y al redactar la narración.

## Tope de 350 segundos e historias por partes

Ningún vídeo pasa de **350 s**: la duración de series e historias se limita a
ese valor, los guiones largos se piden con escenas de unos 8 s (hasta 45),
la narración redactada se limita a ~850 palabras, y el render se **niega** si
el montaje se pasa (el panel Formato lo avisa antes).

Para historias más largas, **por partes**: en la lista de historias, *Continuar
(parte N+1)* escribe la siguiente entrega retomando exactamente donde quedó la
anterior —recibe un resumen y su última frase—, con un gancho que recuerda dónde
iba la historia y un cierre que deja ganas de la siguiente. Se produce con los
mismos ajustes que la parte anterior. Una serie puede pedir de 1 a 6 partes
seguidas por ejecución.

## Voz masculina o femenina

En el selector de voz, *Voz masculina o femenina* filtra las locales por género
y las de IA por una tabla conocida (Kore, Aoede, Leda, Zephyr, coral, nova,
shimmer, sage → femeninas; Puck, Charon, Fenrir, Orus, echo, onyx, fable, ash,
ballad → masculinas). Entre las locales, la femenina neural es **Piper
`es_AR-daniela-high`** (Apache/CC0, incluida en la imagen) y para inglés
`en_US-lessac-medium`; espeak tiene variantes femeninas (`+f3`). Dos voces de
Piper quedan como "desconocido" porque su ficha no lo indica y no he podido
escucharlas.

## Redactar la narración

En la pestaña Voz, tres botones:

- **Redactar narración (texto plano):** la IA reescribe el guion como prosa
  corrida, bien puntuada, con ¡! y ¿? donde toca, sin marcas.
- **Redactar expresiva (marcas para Gemini):** lo mismo, con indicaciones de
  tono breves entre corchetes —`[pausa]`, `[susurrando]`, `[con énfasis]`—
  que **Gemini TTS interpreta** y que las voces locales y OpenAI **ignoran**
  (se quitan antes de leer, y no aparecen en los rótulos).
- **Cargar el guion tal cual:** sin pasar por la IA.

## Cómo funciona

1. **Montaje → Nuevo montaje.** Desde una historia: los clips en secuencia con
   sus duraciones, un rótulo por escena colocado sobre su clip como punto de
   partida, y la narración completa (gancho + escenas) en la pista de voz.
2. **Voz → Generar la voz ahora.** Con la voz local tarda un segundo y te da la
   duración real. A partir de ahí hay dos ayudas de sincronía: *Ajustar clips a
   la voz* (escala todas las duraciones para que el vídeo dure lo que la
   narración) y, en Textos, *Textos desde la narración* (reparte las frases
   sobre la voz en proporción a sus palabras) o *Alinear con los clips* (cada
   rótulo sobre el clip del mismo orden).
3. **Clip.** Duración, segundo de entrada, efecto, buscar / parecido / al azar,
   mover, duplicar, quitar. *Buscar clip parecido* usa el texto que cae encima
   de ese clip en la línea de tiempo.
4. **Texto.** Nuevo en el instante del cabezal, arrastrar para mover, borde
   derecho para estirar, se pega al borde de clip más cercano; estilo y
   animación.
5. **Formato.** Preset y estilo global para todos los rótulos.
6. **Renderizar MP4.** Si la narración del servidor no está generada o cambió
   el texto, se genera en el render.

**Línea de tiempo:** zoom con el deslizador o Ctrl+rueda (de 8 a 240 píxeles
por segundo, con marcas de medio segundo al acercar), cabezal arrastrable,
*Dividir clip* en el cabezal (o tecla S), espacio para reproducir y Supr para
borrar lo seleccionado. La pista de voz muestra una marca por frase medida.

## Precargado por el cron

Una serie con salida **Montaje** hace, en cada ejecución, solo lo barato: escribe
el guion con su título y su gancho, elige un clip por escena **guardando solo el
enlace** —no descarga nada— y deja un proyecto abierto en la pestaña Montaje. Ni
voz ni render: eso se decide mirándolo.

Así puedes tener el cron produciendo un montaje distinto cada día, abrirlos uno a
uno, reproducirlos con la voz del navegador para oír el ritmo, cambiar lo que no
convenza y renderizar solo los que valgan. La historia queda en estado `MONTAJE`
hasta entonces.

## Las capas

| Capa | Opciones |
|---|---|
| Imagen | Un clip por escena, o un fondo de color liso |
| Texto | Uno por escena, con estilo y animación propios |
| Voz | Ninguna · leída por el servidor con una sola voz (local por defecto, o IA) · un archivo que subes |
| Música | Una pista de la biblioteca o una que subes, con su volumen |

Cada capa se construye por separado y solo se juntan en el paso final, así que
cambiar la música no obliga a rehacer la voz ni la imagen.

La narración se genera **de una sola vez con una sola voz** (con IA se trocea
por frases y se pega, todo a 48 kHz). Su duración real se mide del audio —con
ffprobe, o leyendo la cabecera WAV si no está— y es lo que la línea de tiempo
usa para sincronizar. Si el texto o la voz cambian, se regenera; la huella del
par texto+voz decide cuándo.

Con voz, la música se agacha automáticamente cuando alguien habla; sin voz suena
al 60 % como mínimo para que no quede vacío.

## Voz: la del servidor por defecto

La voz por defecto es la **local del servidor**, con `espeak-ng`: no gasta cuota,
no necesita clave, no depende de la red y siempre está. Es robótica —de eso no
hay duda— pero sirve para probar el montaje y para quien no quiera pagar voz.
Cuando quieras algo mejor, en la capa de voz eliges Gemini u OpenAI.

`VOZ_LOCAL_VOZ` elige el idioma y acento (`es-419` por defecto, también `es`,
`en-us`, `en-gb`...) y `VOZ_LOCAL_VELOCIDAD` el ritmo en palabras por minuto.
Verificado en este entorno: una frase de 15 palabras sale en 5,7 s a 150 ppm,
coherente con el cálculo de duración por texto.

Aparte, y sin renderizar, la vista previa puede **leer el texto con la voz del
navegador** (Web Speech API) mientras reproduce. Es una maqueta para oír el
ritmo, no la voz del MP4: la del MP4 es la que elijas en la capa de voz.

## Tipo de letra

Siete tipografías libres instaladas en la imagen: DejaVu Serif, DejaVu Sans,
Liberation Sans, Liberation Serif, Lato, Open Sans y Roboto. Se elige por escena
y con *Aplicar estilo a todas* se copia al resto (la posición de cada escena se
respeta). El navegador carga la misma fuente desde `/api/fuentes/:id`, así que
la vista previa usa la letra que después quemará ffmpeg.

Cada escena tiene además *Otro clip al azar*, que busca con su propio texto y
cambia el clip por otro distinto al actual.

## Clips automáticos, parecidos a la escena

*Completar clips automáticos* (barra superior) rellena las escenas que no tienen
clip; *Buscar clip parecido* (en la escena) lo hace solo con la actual, aunque
ya tuviera uno. En los dos casos el servidor saca de cada texto una a tres
**palabras clave visuales en inglés** con el primer motor de IA que tenga clave
—una sola llamada para todas las escenas— y elige un clip parecido sin
descargarlo. Sin ningún motor configurado cae en una heurística con las
palabras largas del propio texto: peor, pero no se queda vacío.

## Párrafos largos que se van leyendo

Una escena admite hasta **2 000 caracteres y 180 segundos**: un párrafo entero
leído despacio. *Cómo se va leyendo* decide cómo se muestra:

| Lectura | Qué hace |
|---|---|
| todo | El texto entero desde el principio |
| frase a frase | Corta en `. ! ? …` y pega las frases de menos de tres palabras a la anterior |
| por bloques | Grupos de ocho palabras, prefiriendo cortar en comas |

El tiempo de la escena se reparte entre los trozos en proporción a sus palabras,
con un mínimo de 1,1 s por trozo cuando cabe. La vista previa usa **la misma
función de corte** que el servidor, así que enseña los mismos trozos en los
mismos instantes. Con voz de IA, la escena se estira a lo que dure el audio y
los trozos se reparten sobre esa duración real.

## Animaciones

Cuatro, elegidas porque ffmpeg las reproduce **exactamente** igual que la vista
previa, vía etiquetas ASS:

| Animación | Qué hace | En el render |
|---|---|---|
| `ninguna` | Aparece y ya | `\pos` |
| `fundido` | Entra y sale fundido | `\fad(300,300)` |
| `subir` | Sube 70 px al entrar | `\move(...)` + fundido |
| `zoom` | Entra al 82 % y crece | `\t(\fscx\fscy)` + fundido |
| `resaltar` | Ilumina palabra a palabra al ritmo del trozo | Karaoke ASS `\kf` por palabra, con color secundario apagado |

## Efectos de imagen

Sobre el clip o el fondo de cada escena, ya encajado en el lienzo:

| Efecto | En el render | En la vista previa |
|---|---|---|
| zoom lento | `zoompan` que acerca un 12 % a lo largo de la escena (Ken Burns); `crop` no sirve porque sus expresiones no avanzan por fotograma | `transform: scale` animado |
| fundido a negro | `fade` de entrada y salida de hasta 0,5 s | opacidad animada |
| blanco y negro | `hue=s=0` | `filter: grayscale` |
| viñeta | `vignette` | degradado radial superpuesto |

Uno por escena. El panel **Formato** tiene además un **estilo global** —letra,
tamaño, color, contorno, animación, lectura y efecto— que se aplica a todas las
escenas de golpe, respetando la posición de cada una.

## Videoclips musicales

Un proyecto de tipo música es el mismo montaje de tres pistas, pero la canción
manda: la pista de voz nace apagada, la música suena al 100 % (no se agacha,
porque no hay nada que dejar pasar) y la duración del vídeo es la de la
canción, con el tope de 350 segundos.

El montaje automático (pestaña Música de la app) hace esto:

1. Mide la canción con ffprobe.
2. Reparte sus tramos —intro, versos, coros— según la letra o los lineamientos,
   dando más tiempo a los que pesan más.
3. Busca clips con los criterios de cada tramo y llena la imagen: planos de
   hasta 6 segundos en el coro y de hasta 12 en el resto, sin repetir mientras
   haya material.
4. Si se pide, coloca la letra de cada tramo en rótulos de dos líneas.

Desde ahí se edita como cualquier montaje. El botón «Volver a montar el
videoclip» de la pestaña Música rehace la imagen con otros clips para los
mismos tramos; los cortes ya hechos no se tocan.

### La pestaña Letra

La configuración del videoclip vive en el proyecto (campo `letra`), no en el
formulario que lo creó: se guarda al crearlo, antes de montar nada, así que no
se pierde aunque el montaje falle o la canción llegue después. La pestaña
**Letra** la muestra y la deja cambiar:

- la letra, con sus etiquetas `[Verso]` y `[Coro]` si las trae;
- los lineamientos de imagen;
- si la canción es instrumental y si la letra se quema en pantalla;
- los tramos detectados, con su peso, sus palabras de búsqueda y cuál es el
  momento fuerte.

*Guardar* solo guarda. *Guardar y volver a montar* rehace tramos, clips y
rótulos. Si cambia la letra o los lineamientos, los tramos se recalculan; si
no, se reutilizan y solo cambian los clips.

Mientras el servidor monta, el proyecto queda en estado `MONTAJE`: el editor lo
avisa y se refresca solo cada pocos segundos.

### Oír antes de renderizar

La vista previa reproduce la música del proyecto sincronizada con el reloj de
la línea de tiempo, junto a los vídeos de los clips y la narración si la hay.
Es lo que permite cuadrar un corte de plano con la canción sin renderizar. El
volumen de la previa es el mismo de la capa de música; el ducking con voz solo
se aplica al renderizar.

## Cortes: varias salidas del mismo montaje

La pestaña **Cortes** saca del mismo material tantas versiones como haga falta:
la completa en 16:9, la completa en vertical, 30 segundos del coro en 9:16, un
cuadrado para el feed. Cada corte guarda su tramo (`inicio` y `duracion`) y su
formato, y se renderiza por separado.

No se recorta el MP4 ya hecho: se vuelve a renderizar desde los clips, de modo
que cada formato se encuadra bien y no hereda el recorte del anterior. Las
pistas se ajustan al tramo elegido:

- los clips se parten por donde toca, moviendo su recorte de entrada;
- los rótulos se desplazan y los que caen fuera desaparecen;
- la voz y la música se abren en el segundo que corresponde, así que un corte
  del minuto dos suena por el minuto dos y no desde el principio.

En videoclips, «Buscar los mejores momentos» mide el nivel de la canción
segundo a segundo y propone las ventanas con más energía, con un empujón para
el tramo marcado como coro en la letra.

## Descargar el resultado y sus créditos

Al acabar el render hay tres cosas, todas en la lista de **Montaje** (y las dos
primeras también en la barra del editor):

- **Descargar MP4** — el archivo conjunto: imagen, rótulos quemados, narración
  y música en un solo `.mp4`. En el servidor vive en `DATA_DIR/videos/<id>.mp4`
  (el volumen), y la limpieza diaria lo borra a los `RETENCION_DIAS`.
- **Descargar créditos (.txt)** — la descripción para publicar: título (o el
  gancho), hashtags de la historia si la hay, el aviso de contenido con IA y
  los créditos de cada clip (autor, fuente, licencia y página), sin repetir.
  Se baja con el mismo nombre que el MP4 más `-creditos.txt`.
- **Copiar descripción** — lo mismo, al portapapeles, para pegarlo en TikTok.

Además, **los créditos viajan dentro del MP4** como metadatos (`title` y
`comment`): aunque se pierda el `.txt`, cualquier reproductor o `ffprobe` los
muestra. La descripción queda guardada en el proyecto y se ve en la lista.

## Ver el resultado

El editor no muestra el vídeo terminado: cuando el render acaba aparece solo un
enlace *MP4 listo: descargar* en la barra. Para verlo de corrido, en la lista de
**Montaje** cada proyecto tiene *Ver de corrido* y *Descargar MP4*.

## Formatos

| Preset | Lienzo | Recomendado hasta |
|---|---|---|
| TikTok / Reels / Shorts | 1080×1920 | 180 s |
| Instagram feed | 1080×1350 | 90 s |
| Cuadrado | 1080×1080 | 90 s |
| YouTube | 1920×1080 | 600 s |
| Facebook historia | 1080×1920 | 60 s |

Si el montaje se pasa de lo recomendado, el panel de formato avisa pero no corta:
la decisión es tuya.

## Subir voz o música propias

Hasta 40 MB por archivo, en mp3, m4a, wav, ogg, aac o flac. Tres cosas pasan
antes de aceptarlo:

- El **nombre lo genera el servidor** (un uuid): el que venga del navegador no
  se usa nunca para construir la ruta.
- Se comprueba la extensión y el tamaño.
- Se pasa **ffprobe** al archivo ya guardado y, si no trae ninguna pista de
  audio, se borra y se rechaza. Que se llame `.mp3` no basta.

Los archivos viven en `DATA_DIR/proyectos/<id>/`.

### Subir la canción

En la pestaña **Música** del editor, «O sube la canción desde tu computadora»
guarda el archivo dentro del proyecto y lo deja puesto como su música de una
vez (mp3, m4a, wav, ogg, aac o flac, hasta 80 MB). El nombre lo pone el
servidor y el contenido se comprueba con ffprobe: si no trae pista de audio, se
borra y no se guarda nada.

En un videoclip recién creado, subir la canción arranca el montaje solo: es lo
último que faltaba. Si lo que quieres es cambiar la pista de un videoclip que
ya estaba montado, pulsa después «Volver a montar el videoclip» para que la
imagen se rehaga con la duración de la pista nueva; el proyecto se guarda solo
antes de montar.

### Música desde Suno

En la pestaña **Música** del editor hay un campo *Música desde Suno*: pega el
enlace de la canción (`https://suno.com/song/<id>`) y la app la descarga desde
el CDN de Suno a la carpeta del proyecto, la comprueba con ffprobe y la deja
seleccionada. El crédito `Música: Suno — enlace` se añade solo a la descripción
y al `.txt` de créditos al renderizar. Si prefieres tenerla en la biblioteca
para todos los proyectos y las series, añádela desde el selector de música de
Crear o Series.


## Lo que este editor todavía NO hace

Para que quede claro qué esperar:

- **No recorta dentro de un clip.** Cada escena usa el clip desde el principio y
  lo repite en bucle si hace falta; no hay punto de entrada ni de salida.
- **No hay varias capas de texto a la vez** ni stickers, ni pistas superpuestas
  de vídeo.
- **No hay fotogramas clave** ni curvas de animación: las cuatro animaciones son
  de entrada, no programables.
- **No hay transiciones entre escenas**, solo cortes (el fundido a negro por
  escena es lo más parecido).
- **El karaoke reparte el tiempo por longitud de palabra**, no por el audio
  real: con voz de IA va aproximadamente a la par, no sincronizado al
  milisegundo.
- **La vista previa es orientativa.** Posición, tamaño, color y animación se
  corresponden con el render, pero el salto de línea puede caer distinto unos
  píxeles, porque el navegador y libass no miden el texto igual.
- **La vista previa no reproduce la música**, solo la narración.
- **El karaoke dentro de una frase sigue siendo proporcional** a la longitud
  de las palabras; lo exacto es el inicio y el fin de cada frase.
