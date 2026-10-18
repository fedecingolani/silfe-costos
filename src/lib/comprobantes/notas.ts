/**
 * Notas de crédito y débito generadas desde un comprobante autorizado: un
 * borrador con el mismo cliente, punto de venta, lista de precios y
 * condición de pago, fecha de hoy, los ítems copiados (para ajustar
 * cantidades o precios) y el comprobante de origen como asociado. La letra
 * es la del origen (ARCA exige la misma); el ambiente lo fija la base con
 * el del asociado (guardar_borrador_comprobante).
 */
import { NOMBRES_CLASE_COMPROBANTE, type ClaseComprobante, type EstadoComprobante, type LetraComprobante } from "@/lib/tipos";
import { notasPermitidas, type AsociadoGuardado } from "./asociados";
import type { CabeceraGuardada, ItemGuardado } from "./borrador";
import { calcularTotales, tasaDeFila } from "./calculo";
import { tipoArcaDe } from "./letra";

export type OrigenNota = {
  id: string;
  estado: EstadoComprobante;
  clase: ClaseComprobante;
  letra: LetraComprobante | null;
  punto_venta: number;
  cliente_id: string;
  lista_precio_id: string | null;
  condicion_pago: CabeceraGuardada["condicion_pago"];
};

export type NotaArmada = { cabecera: CabeceraGuardada; items: ItemGuardado[]; asociados: AsociadoGuardado[] };

/**
 * @param puntosActivos puntos de venta electrónicos activos, de menor a mayor.
 */
export function armarNota(
  origen: OrigenNota,
  items: readonly ItemGuardado[],
  clase: ClaseComprobante,
  hoy: string,
  puntosActivos: readonly number[],
): NotaArmada | { error: string } {
  if (origen.estado !== "autorizado" || !origen.letra) {
    return { error: "Sólo se generan notas de crédito o débito desde un comprobante autorizado." };
  }
  if (clase === "factura" || !notasPermitidas(origen).includes(clase)) {
    return {
      error:
        `Desde una ${NOMBRES_CLASE_COMPROBANTE[origen.clase].toLowerCase()} no se puede generar una ` +
        `${NOMBRES_CLASE_COMPROBANTE[clase].toLowerCase()}.`,
    };
  }
  const puntoVenta = puntosActivos.includes(Number(origen.punto_venta)) ? Number(origen.punto_venta) : puntosActivos[0];
  if (puntoVenta === undefined) return { error: "No hay ningún punto de venta electrónico activo." };

  const copiados = items.map((i) => ({ ...i }));
  const totales = calcularTotales(
    copiados.map((i) => ({
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      descuentoPct: Number(i.descuento_pct),
      alicuotaIva: tasaDeFila(i),
    })),
  );

  return {
    cabecera: {
      punto_venta: puntoVenta,
      clase,
      letra: origen.letra,
      tipo_arca: tipoArcaDe(origen.letra, clase),
      fecha: hoy,
      fecha_vencimiento_pago: hoy,
      cliente_id: origen.cliente_id,
      lista_precio_id: origen.lista_precio_id,
      condicion_pago: origen.condicion_pago,
      observaciones: null,
      periodo_asoc_desde: null,
      periodo_asoc_hasta: null,
      neto: totales.neto,
      no_gravado: totales.noGravado,
      iva: totales.iva,
      total: totales.total,
    },
    items: copiados,
    asociados: [{ asociado_id: origen.id }],
  };
}
