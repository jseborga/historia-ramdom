/**
 * Convierte un secreto en el valor `enc:...` que se pega en las variables de
 * entorno del servidor, y opcionalmente genera el hash argon2id del login
 * maestro. Usa la misma ENCRYPTION_KEY que la aplicacion.
 *
 *   node dist/scripts/cifrar-secreto.js            -> cifra un valor
 *   node dist/scripts/cifrar-secreto.js --password -> hash para ADMIN_PASSWORD_HASH
 */
import argon2 from "argon2";
import { createInterface } from "node:readline/promises";
import { claveDesdeBase64, cifrarCon, envolver } from "../seguridad/aes.js";

const esPassword = process.argv.includes("--password");
const rl = createInterface({ input: process.stdin, output: process.stdout });

if (esPassword) {
  const password = await rl.question("Contrasena del administrador (minimo 12): ");
  rl.close();
  if (password.length < 12) throw new Error("La contrasena es demasiado corta");
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  console.log("\nADMIN_PASSWORD_HASH=" + hash);
  console.log("\nSi ademas quieres guardarlo cifrado, vuelve a pasarlo por este script sin --password.");
} else {
  const clave = process.env.ENCRYPTION_KEY;
  if (!clave) throw new Error("Falta ENCRYPTION_KEY en el entorno");
  const valor = await rl.question("Valor a cifrar: ");
  rl.close();
  if (!valor) throw new Error("No se puede cifrar un valor vacio");
  console.log("\n" + envolver(cifrarCon(claveDesdeBase64(clave), valor)));
}

process.exit(0);
