# Editor de montaje

Una línea de tiempo al estilo CapCut dentro de la app: se abre con el vídeo ya
montado y desde ahí se cambia pieza a pieza.

## Cómo funciona

1. **Montaje → Nuevo montaje.** Partiendo de una historia, la línea de tiempo se
   arma sola: el gancho como primera escena y después el resto en orden, con los
   clips que ya se habían elegido. Se abre con algo montado, no con un lienzo en
   blanco.
2. **Vista previa.** Reproduce las escenas en secuencia con sus duraciones
   reales y rotula el texto donde va a quedar. *Reproducir* recorre el montaje
   entero.
3. **Escena.** Texto, duración, animación, posición, tamaño, color, contorno y
   negrita. El clip se cambia buscando por palabras libres; si no hay clip, la
   escena es un fondo de color.
4. **Voz y música.** Dos capas independientes que se mezclan al final.
5. **Formato.** El preset decide el lienzo; todo se recalcula sobre él.
6. **Renderizar MP4.** Un solo archivo, listo para subir.

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
| Voz | Ninguna · generada en el servidor (voz local por defecto, o IA) · un archivo que subes |
| Música | Una pista de la biblioteca o una que subes, con su volumen |

Cada capa se construye por separado y solo se juntan en el paso final, así que
cambiar la música no obliga a rehacer la voz ni la imagen.

**Con voz de IA, la escena nunca se acorta por debajo de su audio**: si la frase
dura más que la duración fijada, la escena se estira para no cortarla. Con un
archivo de voz propio manda tu archivo y las duraciones son las que tú pongas.

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
| zoom lento | `crop` que se encoge un 12 % con el tiempo y vuelve a escalar (Ken Burns) | `transform: scale` animado |
| fundido a negro | `fade` de entrada y salida de hasta 0,5 s | opacidad animada |
| blanco y negro | `hue=s=0` | `filter: grayscale` |
| viñeta | `vignette` | degradado radial superpuesto |

Uno por escena. El panel **Formato** tiene además un **estilo global** —letra,
tamaño, color, contorno, animación, lectura y efecto— que se aplica a todas las
escenas de golpe, respetando la posición de cada una.

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
- **La voz de IA se genera al renderizar**, no al editar, así que su duración
  real no se ve en la vista previa hasta que el MP4 está hecho.
