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

## Animaciones

Cuatro, elegidas porque ffmpeg las reproduce **exactamente** igual que la vista
previa, vía etiquetas ASS:

| Animación | Qué hace | En el render |
|---|---|---|
| `ninguna` | Aparece y ya | `\pos` |
| `fundido` | Entra y sale fundido | `\fad(300,300)` |
| `subir` | Sube 70 px al entrar | `\move(...)` + fundido |
| `zoom` | Entra al 82 % y crece | `\t(\fscx\fscy)` + fundido |

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
- **No hay transiciones entre escenas**, solo cortes.
- **La vista previa es orientativa.** Posición, tamaño, color y animación se
  corresponden con el render, pero el salto de línea puede caer distinto unos
  píxeles, porque el navegador y libass no miden el texto igual.
- **La voz de IA se genera al renderizar**, no al editar, así que su duración
  real no se ve en la vista previa hasta que el MP4 está hecho.
