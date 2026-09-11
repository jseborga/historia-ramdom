import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM con la clave pasada como argumento. Vive separado de
 * `cifrado.ts` para que `env.ts` pueda descifrar variables de entorno sin
 * depender de `env` (dependencia circular).
 */
export function claveDesdeBase64(valor: string): Buffer {
  const clave = Buffer.from(valor, "base64");
  if (clave.length !== 32) throw new Error("La clave debe ser base64 de 32 bytes");
  return clave;
}

export function cifrarCon(clave: Buffer, texto: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", clave, iv);
  const datos = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString("base64")).join(".");
}

export function descifrarCon(clave: Buffer, paquete: string): string {
  const partes = paquete.split(".");
  if (partes.length !== 3) throw new Error("Paquete cifrado con formato invalido");
  const [iv, tag, datos] = partes.map((p) => Buffer.from(p, "base64"));
  const d = createDecipheriv("aes-256-gcm", clave, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString("utf8");
}

/** Prefijo que marca una variable de entorno cifrada: `enc:iv.tag.datos`. */
export const PREFIJO_CIFRADO = "enc:";

export const estaCifrado = (valor: string) => valor.startsWith(PREFIJO_CIFRADO);

export const envolver = (paquete: string) => `${PREFIJO_CIFRADO}${paquete}`;
