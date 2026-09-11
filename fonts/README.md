# Fuentes para los subtitulos

La imagen de Docker instala `fonts-dejavu-core`, asi que el estilo por defecto
(`DejaVu Serif`, en `src/render/subtitulos.ts`) funciona sin anadir nada aqui.

Para usar otra tipografia:

1. Copia su archivo `.ttf` o `.otf` **con licencia libre** en esta carpeta.
2. Cambia `DejaVu Serif` por el nombre interno de la fuente en
   `src/render/subtitulos.ts`.

ffmpeg lee esta carpeta a traves de `fontsdir` al quemar los subtitulos.
