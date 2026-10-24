/**
 * Presupuestos: lo que manda la pantalla y lo que se guarda con
 * guardar_presupuesto. Los ítems y los totales se arman igual que en un
 * comprobante (mismas funciones); la cabecera no lleva punto de venta,
 * letra, clase ni nada de ARCA, y suma "válido hasta".
 */
import {
  armarItems,
  erroresVencimiento,
  esObjeto,
  esUuid,
  texto,
  totalesDeItems,
  vencimientoPara,
  type FilaItemEnviada,
  type ItemGuardado,
  type ProductoCatalogo,
} from "@/lib/comprobantes/borrador";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { CONDICIONES_PAGO, DIAS_VALIDEZ_PRESUPUESTO, type CondicionPago } from "@/lib/tipos";

// ----- Lo que manda la pantalla ---------------------------------------------

export type PresupuestoEnviado = {
  clienteId: string;
  /** yyyy-mm-dd */
  fecha: string;
  /** yyyy-mm-dd. Vacío: la fecha más 15 días. */
  validoHasta: string;
  fechaVencimientoPago: string;
  condicionPago: CondicionPago;
  listaPrecioId: string | null;
  observaciones: string;
  items: FilaItemEnviada[];
};

// ----- Lo que se guarda (parámetros de guardar_presupuesto) ----------------

export type CabeceraPresupuestoGuardada = {
  cliente_id: string;
  fecha: string;
  valido_hasta: string;
  fecha_vencimiento_pago: string;
  condicion_pago: CondicionPago;
  lista_precio_id: string | null;
  observaciones: string | null;
  neto: number;
  no_gravado: number;
  iva: number;
  total: number;
};

/** Los ítems tienen las mismas columnas que los de un comprobante. */
export type ItemPresupuestoGuardado = ItemGuardado;

export type PresupuestoArmado = {
  cabecera: CabeceraPresupuestoGuardada;
  items: ItemPresupuestoGuardado[];
};

// ----- Validez --------------------------------------------------------------

/** "Válido hasta" que se propone: la fecha más 15 días. Vacío si la fecha no es válida. */
export function validezPorDefecto(fecha: string): string {
  if (!esFechaValida(fecha)) return "";
  const [anio, mes, dia] = fecha.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + DIAS_VALIDEZ_PRESUPUESTO)).toISOString().slice(0, 10);
}

// ----- Armar lo que se guarda -----------------------------------------------

/**
 * Valida lo enviado por la pantalla y arma la cabecera y los ítems para
 * guardar_presupuesto. Ítems, importes, totales y vencimiento del cobro
 * siguen las reglas de la factura; además pide al menos un ítem y un
 * "válido hasta" no anterior a la fecha (vacío: la fecha más 15 días).
 */
export function armarPresupuesto(
  enviado: unknown,
  contexto: { productos: ReadonlyMap<string, ProductoCatalogo> },
): { presupuesto: PresupuestoArmado } | { errores: string[] } {
  if (!esObjeto(enviado) || !Array.isArray(enviado.items)) {
    return { errores: ["Los datos del presupuesto no son válidos."] };
  }
  const errores: string[] = [];

  const clienteId = esUuid(enviado.clienteId) ? enviado.clienteId : null;
  if (!clienteId) errores.push("Elegí el cliente.");

  const fecha = typeof enviado.fecha === "string" && esFechaValida(enviado.fecha) ? enviado.fecha : null;
  if (!fecha) errores.push("La fecha del presupuesto no es válida.");

  const validoEnviado = typeof enviado.validoHasta === "string" ? enviado.validoHasta.trim() : "";
  const validoHasta = validoEnviado === "" && fecha ? validezPorDefecto(fecha) : validoEnviado;
  if (fecha) {
    if (!esFechaValida(validoHasta)) errores.push("La fecha «válido hasta» no es válida.");
    else if (validoHasta < fecha) errores.push("«Válido hasta» no puede ser anterior a la fecha.");
  }

  const condicionPago = (CONDICIONES_PAGO as readonly unknown[]).includes(enviado.condicionPago)
    ? (enviado.condicionPago as CondicionPago)
    : null;
  if (!condicionPago) errores.push("Elegí la condición de pago.");

  const vencimientoEnviado = typeof enviado.fechaVencimientoPago === "string" ? enviado.fechaVencimientoPago : "";
  if (fecha && condicionPago) errores.push(...erroresVencimiento(condicionPago, fecha, vencimientoEnviado));

  const listaPrecioId = esUuid(enviado.listaPrecioId) ? enviado.listaPrecioId : null;

  if (enviado.items.length === 0) errores.push("Agregá al menos un ítem.");
  const { items, errores: erroresItems } = armarItems(enviado.items, contexto.productos);
  errores.push(...erroresItems);

  if (errores.length > 0) return { errores };

  const totales = totalesDeItems(items);
  return {
    presupuesto: {
      cabecera: {
        cliente_id: clienteId!,
        fecha: fecha!,
        valido_hasta: validoHasta,
        fecha_vencimiento_pago: vencimientoPara(condicionPago!, fecha!, vencimientoEnviado),
        condicion_pago: condicionPago!,
        lista_precio_id: listaPrecioId,
        observaciones: texto(enviado.observaciones),
        neto: totales.neto,
        no_gravado: totales.noGravado,
        iva: totales.iva,
        total: totales.total,
      },
      items,
    },
  };
}

// ----- Errores al guardar ---------------------------------------------------

/** Por código de la base (PR00x) y por su pista, por si llega sólo una de las dos. */
const MENSAJES_GUARDADO: Record<string, string> = {
  PR001: "El presupuesto está convertido: no se puede modificar ni borrar.",
  presupuesto_convertido_inmutable: "El presupuesto está convertido: no se puede modificar ni borrar.",
  PR002: "El presupuesto cambió de estado. Recargá la página.",
  transicion_invalida: "El presupuesto cambió de estado. Recargá la página.",
  PR003: "Sólo se pueden borrar presupuestos abiertos.",
  borrado_no_permitido: "Sólo se pueden borrar presupuestos abiertos.",
  PR004: "No se encontró el presupuesto. Puede que lo hayan borrado.",
  presupuesto_inexistente: "No se encontró el presupuesto. Puede que lo hayan borrado.",
  PR005: "El presupuesto ya se convirtió en factura.",
  presupuesto_ya_convertido: "El presupuesto ya se convirtió en factura.",
  PR006: "El número del presupuesto no se puede cambiar.",
  numero_no_editable: "El número del presupuesto no se puede cambiar.",
  PR007: "No hay un punto de venta electrónico activo para generar la factura.",
  punto_venta_invalido: "No hay un punto de venta electrónico activo para generar la factura.",
  "23503": "El cliente, la lista de precios o un producto ya no existen. Recargá la página.",
};

/** Controles de la tabla (23514), por nombre de la restricción. */
const MENSAJES_CONTROL: [restriccion: string, mensaje: string][] = [
  ["presupuesto_valido_hasta_check", "«Válido hasta» no puede ser anterior a la fecha."],
  ["presupuesto_vencimiento_check", "El vencimiento del cobro no puede ser anterior a la fecha."],
  ["presupuesto_condicion_pago_check", "Elegí la condición de pago."],
  ["presupuesto_item_", "Revisá los ítems: hay datos que no son válidos."],
];

/** Mensaje legible de un error de la base al guardar, borrar o convertir un presupuesto. */
export function mensajeErrorGuardado(error: { code?: string; message: string; hint?: string | null }): string {
  if (error.code === "23514") {
    const control = MENSAJES_CONTROL.find(([restriccion]) => error.message.includes(restriccion));
    if (control) return control[1];
  }
  return (
    (error.code && MENSAJES_GUARDADO[error.code]) ||
    (error.hint && MENSAJES_GUARDADO[error.hint]) ||
    `No se pudo guardar el presupuesto: ${error.message}`
  );
}
