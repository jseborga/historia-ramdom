import { env } from "../env.js";
import { claveDesdeBase64, cifrarCon, descifrarCon } from "./aes.js";

const CLAVE = claveDesdeBase64(env.ENCRYPTION_KEY);

export const cifrar = (texto: string) => cifrarCon(CLAVE, texto);
export const descifrar = (paquete: string) => descifrarCon(CLAVE, paquete);
