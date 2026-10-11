import { citasEn, clavesQueFaltan, formatearCita, leerCita, textoDelPasaje } from "../servicios/biblia.js";
import { REFERENCIAS_BASE } from "../servicios/bibliaReferencias.js";

/**
 * Comprueba la base de «Aprendiendo con la Biblia» contra el texto:
 *   - que cada cita exista en la Reina-Valera 1909;
 *   - que el pasaje contenga sus palabras clave (que diga lo que se cuenta);
 *   - que las citas de los cierres existan.
 *
 * Con `--ver` enseña además el texto de cada cita, para leerlo a ojo.
 * Sale con error si algo falla: así no se sube una base con una cita mala.
 */

const ver = process.argv.includes("--ver");
let fallos = 0;
const vistas = new Set<string>();

for (const r of REFERENCIAS_BASE) {
  const p = leerCita(r.cita);
  if (!p) {
    console.log(`✗ ${r.cita}: no existe`);
    fallos++;
    continue;
  }
  const cita = formatearCita(p);
  if (vistas.has(cita)) {
    console.log(`✗ ${cita}: repetida`);
    fallos++;
  }
  vistas.add(cita);
  const faltan = clavesQueFaltan(p, r.claves);
  if (faltan.length) {
    console.log(`✗ ${cita}: el texto no dice ${faltan.map((f) => `«${f}»`).join(", ")}`);
    console.log(`    ${textoDelPasaje(p).slice(0, 400)}`);
    fallos++;
  } else if (ver) {
    console.log(`✓ ${cita}: ${textoDelPasaje(p).slice(0, 300)}`);
  }
  for (const c of citasEn(r.remate ?? "")) {
    if (!c.cita) {
      console.log(`✗ ${cita}: la cita del cierre «${c.original}» no existe`);
      fallos++;
    } else if (ver) {
      console.log(`    cierre → ${c.cita}: ${c.texto?.slice(0, 200)}`);
    }
  }
}

console.log(`\n${REFERENCIAS_BASE.length} referencias, ${fallos} fallos.`);
process.exit(fallos ? 1 : 0);
