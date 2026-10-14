/**
 * Mensajes legibles para los errores de la base al guardar clientes,
 * sucursales, contactos e interacciones. Las acciones los devuelven en lugar de lanzarlos:
 * en producción Next reemplaza el mensaje de un error lanzado por uno genérico.
 */

/** Lo que importa de un error de Supabase (PostgREST). */
export type ErrorBase = { code?: string; message: string };

/** Mensaje por código de error de Postgres y nombre de restricción. */
type Mensajes = Partial<Record<string, Record<string, string>>>;

/** Busca un mensaje para el código del error y la restricción que nombra su texto. */
function traducir(error: ErrorBase, mensajes: Mensajes): string | null {
  const porRestriccion = error.code ? mensajes[error.code] : undefined;
  if (!porRestriccion) return null;
  const restriccion = Object.keys(porRestriccion).find((r) => error.message.includes(r));
  return restriccion ? porRestriccion[restriccion] : null;
}

const MENSAJES_CLIENTE: Mensajes = {
  "23514": {
    cliente_cbu_check: "El CBU debe tener exactamente 22 dígitos.",
    cliente_cvu_check: "El CVU debe tener exactamente 22 dígitos.",
    cliente_alias_bancario_check: "El alias lleva de 6 a 20 caracteres: letras, números, punto y guion.",
    cliente_condicion_iva_check: "La condición frente al IVA no es válida.",
  },
  "23503": {
    cliente_transporte_id_fkey: "El transporte elegido ya no existe.",
  },
};

export function mensajeErrorCliente(accion: string, error: ErrorBase): string {
  return traducir(error, MENSAJES_CLIENTE) ?? `No se pudo ${accion} el cliente: ${error.message}`;
}

const MENSAJES_SUCURSAL: Mensajes = {
  "23502": { nombre: "La sucursal necesita un nombre." },
  "23505": {
    cliente_sucursal_principal_unica:
      "Otra sucursal se marcó como principal al mismo tiempo. Volvé a intentarlo.",
  },
  "23503": {
    cliente_sucursal_transporte_id_fkey: "El transporte elegido ya no existe.",
    cliente_sucursal_cliente_id_fkey: "El cliente ya no existe.",
  },
  // no_data_found, que levantan guardar_sucursal y marcar_sucursal_principal.
  P0002: {
    "No existe el cliente": "El cliente ya no existe.",
    "No existe la sucursal": "La sucursal ya no existe.",
  },
};

export function mensajeErrorSucursal(accion: string, error: ErrorBase): string {
  return traducir(error, MENSAJES_SUCURSAL) ?? `No se pudo ${accion} la sucursal: ${error.message}`;
}

const MENSAJES_CONTACTO: Mensajes = {
  "23502": { nombre: "El contacto necesita un nombre." },
  "23514": {
    cliente_contacto_email_check: "El email tiene que tener una arroba.",
  },
  "23503": {
    cliente_contacto_sucursal_fk: "La sucursal elegida ya no existe o es de otro cliente.",
    cliente_contacto_cliente_id_fkey: "El cliente ya no existe.",
  },
};

export function mensajeErrorContacto(accion: string, error: ErrorBase): string {
  return traducir(error, MENSAJES_CONTACTO) ?? `No se pudo ${accion} el contacto: ${error.message}`;
}

const MENSAJES_INTERACCION: Mensajes = {
  "23502": { resumen: "Escribí un resumen de la interacción." },
  "23514": {
    cliente_interaccion_resumen_check: "Escribí un resumen de la interacción.",
    cliente_interaccion_tipo_check: "El tipo de interacción no es válido.",
    cliente_interaccion_sentido_check: "El sentido de la interacción no es válido.",
  },
  "23503": {
    cliente_interaccion_contacto_fk: "El contacto elegido ya no existe o es de otro cliente.",
    cliente_interaccion_cliente_id_fkey: "El cliente ya no existe.",
  },
};

export function mensajeErrorInteraccion(accion: string, error: ErrorBase): string {
  return traducir(error, MENSAJES_INTERACCION) ?? `No se pudo ${accion} la interacción: ${error.message}`;
}
