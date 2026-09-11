import argon2 from "argon2";
import { createInterface } from "node:readline/promises";
import { db } from "../db.js";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = (await rl.question("Correo del administrador: ")).trim();
const password = await rl.question("Contrasena (minimo 12 caracteres): ");
rl.close();

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("El correo no es valido");
if (password.length < 12) throw new Error("La contrasena es demasiado corta");

const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
await db.user.upsert({
  where: { email },
  create: { email, passwordHash },
  update: { passwordHash },
});
console.log("Administrador creado");
process.exit(0);
