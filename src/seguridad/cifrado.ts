import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";

const CLAVE = Buffer.from(env.ENCRYPTION_KEY, "base64");

export function cifrar(texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", CLAVE, iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString("base64")).join(".");
}

export function descifrar(paquete: string): string {
  const partes = paquete.split(".");
  if (partes.length !== 3) throw new Error("Paquete cifrado con formato invalido");
  const [iv, tag, datos] = partes.map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", CLAVE, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString("utf8");
}
