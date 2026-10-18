/**
 * Cartera de cheques: transiciones de estado (las mismas que controla la
 * base), cuándo se puede anular un recibo y el borrador de la nota de
 * débito por un cheque rechazado.
 */
import type { ClaseComprobante, CondicionIva, EstadoCheque, LetraComprobante } from "@/lib/tipos";
import { validarPeriodoAsociado } from "@/lib/comprobantes/asociados";
import type { ItemGuardado } from "@/lib/comprobantes/borrador";
import { NO_GRAVADO, calcularItem, calcularTotales, type ItemACalcular } from "@/lib/comprobantes/calculo";
import { letraYTipo, tipoArcaDe } from "@/lib/comprobantes/letra";
import type { NotaArmada } from "@/lib/comprobantes/notas";

/**
 * en_cartera → depositado | entregado | rechazado; depositado y entregado →
 * rechazado. anulado sólo lo pone la anulación del recibo.
 */
export const TRANSICIONES_CHEQUE: Record<EstadoCheque, readonly EstadoCheque[]> = {
  en_cartera: ["depositado", "entregado", "rechazado"],
  depositado: ["rechazado"],
  entregado: ["rechazado"],
  rechazado: [],
  anulado: [],
};

export function puedePasar(desde: EstadoCheque, hacia: EstadoCheque): boolean {
  return TRANSICIONES_CHEQUE[desde].includes(hacia);
}

/** Un recibo se anula sólo si todos sus cheques siguen en cartera. */
export function puedeAnularRecibo(cheques: readonly { estado: EstadoCheque }[]): boolean {
  return cheques.every((cheque) => cheque.estado === "en_cartera");
}

// ----- Nota de débito por cheque rechazado -------------------------------------

export type ChequeRechazado = { numero: string; banco: string; importe: number; clienteId: string };

/** Comprobante que canceló el recibo del cheque (sus imputaciones). */
export type ComprobanteImputado = { id: string; clase: ClaseComprobante; letra: LetraComprobante | null };

export type ContextoRechazo = {
  /** Fecha de la nota, yyyy-mm-dd. */
  hoy: string;
  /** Punto de venta en que se emite la nota. */
  puntoVenta: number;
  condicionIva: CondicionIva | null;
  listaPrecioId: string | null;
  /** Fecha del recibo del cheque, yyyy-mm-dd. */
  reciboFecha: string;
  imputados: readonly ComprobanteImputado[];
  /** Gastos bancarios del rechazo: van en un ítem gravado al 21%. */
  gastos?: { importe: number; descripcion: string } | null;
};

/**
 * Borrador de la nota de débito al cliente por el capital del cheque, como
 * ítem no gravado, y los gastos bancarios (si hay) en un ítem al 21%. Es el
 * mismo armado que hace la base en rechazar_cheque (la que crea la ND); la
 * pantalla lo usa para mostrar antes del rechazo qué ND se va a crear.
 * Se asocia a las facturas que canceló el recibo del cheque (con su letra,
 * como exige ARCA); si fue a cuenta, al período del mes del recibo, del
 * primer día a la fecha del recibo (mismo mes, 10209; hasta ≤ nota, 10208).
 */
export function armarNotaDebitoRechazo(cheque: ChequeRechazado, contexto: ContextoRechazo): NotaArmada | { error: string } {
  const facturas = [...new Map(contexto.imputados.filter((c) => c.clase === "factura").map((c) => [c.id, c])).values()];

  let letra: LetraComprobante;
  if (facturas.length > 0) {
    const letras = [...new Set(facturas.map((f) => f.letra).filter((l): l is LetraComprobante => l !== null))].sort();
    if (letras.length === 0) {
      return {
        error: "Las facturas que canceló el recibo del cheque no tienen letra: no se puede armar la nota de débito.",
      };
    }
    if (letras.length > 1) {
      return {
        error: `El recibo del cheque canceló facturas ${letras.join(" y ")}: la nota de débito lleva una sola letra.`,
      };
    }
    letra = letras[0];
  } else {
    try {
      letra = letraYTipo(contexto.condicionIva, "nota_debito").letra;
    } catch (error) {
      return { error: (error as Error).message };
    }
  }

  const periodo = facturas.length > 0 ? null : { desde: `${contexto.reciboFecha.slice(0, 7)}-01`, hasta: contexto.reciboFecha };
  if (periodo) {
    const errores = validarPeriodoAsociado(periodo, contexto.hoy);
    if (errores.length > 0) return { error: errores[0] };
  }

  const item: ItemGuardado = {
    producto_id: null,
    codigo: null,
    descripcion: `Cheque rechazado N° ${cheque.numero} – ${cheque.banco}`,
    observaciones: null,
    unidad: null,
    cantidad: 1,
    precio_unitario: cheque.importe,
    descuento_pct: 0,
    gravado: false,
    alicuota_iva: null,
    importe: cheque.importe,
    iva: 0,
  };
  const items: ItemGuardado[] = [item];
  const aCalcular: ItemACalcular[] = [{ cantidad: 1, precioUnitario: cheque.importe, descuentoPct: 0, alicuotaIva: NO_GRAVADO }];
  const gastos = contexto.gastos && contexto.gastos.importe > 0 ? contexto.gastos : null;
  if (gastos) {
    const gasto: ItemACalcular = { cantidad: 1, precioUnitario: gastos.importe, descuentoPct: 0, alicuotaIva: 21 };
    items.push({
      ...item,
      descripcion: gastos.descripcion,
      precio_unitario: gastos.importe,
      gravado: true,
      alicuota_iva: 21,
      ...calcularItem(gasto),
    });
    aCalcular.push(gasto);
  }
  const totales = calcularTotales(aCalcular);

  return {
    cabecera: {
      punto_venta: contexto.puntoVenta,
      clase: "nota_debito",
      letra,
      tipo_arca: tipoArcaDe(letra, "nota_debito"),
      fecha: contexto.hoy,
      fecha_vencimiento_pago: contexto.hoy,
      cliente_id: cheque.clienteId,
      lista_precio_id: contexto.listaPrecioId,
      condicion_pago: "cuenta_corriente",
      observaciones: null,
      periodo_asoc_desde: periodo?.desde ?? null,
      periodo_asoc_hasta: periodo?.hasta ?? null,
      neto: totales.neto,
      no_gravado: totales.noGravado,
      iva: totales.iva,
      total: totales.total,
    },
    items,
    asociados: facturas.map((f) => ({ asociado_id: f.id })),
  };
}
