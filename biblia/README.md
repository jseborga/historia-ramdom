# Texto bíblico

`rv1909.txt.gz` es la **Santa Biblia Reina-Valera 1909**, de **dominio
público**, tal como la distribuye eBible.org en formato VPL (un versículo por
línea: `GEN 1:1 EN el principio crió Dios los cielos y la tierra.`).

- Origen: <https://ebible.org/find/details.php?id=spaRV1909>
  (paquete `spaRV1909_vpl.zip`, archivo `spaRV1909_vpl.txt`).
- 66 libros, 31 102 versículos. Sin notas ni títulos de sección.
- Las palabras entre corchetes (`[están]`) son las que añadieron los
  traductores; la app las enseña sin corchetes.
- Ortografía de 1909: «crió», «fué», «á». Es el texto tal cual, que es lo que
  hace que las citas sean exactas.

La app lo lee al arrancar (`src/servicios/biblia.ts`) para comprobar cada cita
de «Aprendiendo con la Biblia»: que el versículo exista y que diga lo que se
cuenta. La Reina-Valera 1960, la más leída hoy, no se puede incluir: tiene
derechos de autor de las Sociedades Bíblicas Unidas.

Para actualizarlo, se baja el paquete de nuevo y se comprime igual:

```sh
gzip -9 -n -c spaRV1909_vpl.txt > biblia/rv1909.txt.gz
npm run biblia:verificar
```
