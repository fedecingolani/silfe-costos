const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verdadero si el valor es un uuid. Sirve para dar 404 sin consultar ante un id inválido en la URL. */
export function esUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}
