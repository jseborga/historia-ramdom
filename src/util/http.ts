/**
 * `Response.json()` devuelve `unknown` en los tipos de Node. Las respuestas de
 * los proveedores externos se validan en el punto de uso, asi que aqui se
 * devuelve un objeto suelto para poder leerlas sin ruido de tipos.
 */
export async function leerJSON(res: Response): Promise<any> {
  return res.json().catch(() => null);
}
