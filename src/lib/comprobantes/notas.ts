/**
 * Notas de crédito y débito generadas desde un comprobante autorizado: un
 * borrador con el mismo cliente, punto de venta, lista de precios y
 * condición de pago, fecha de hoy, los ítems copiados (para ajustar
 * cantidades o precios) y el comprobante de origen como asociado. La letra
 * es la del origen (ARCA exige la misma); el ambiente lo fija la base con
 * el del asociado (guardar_borrador_comprobante). Desde un X la nota es X:
 * en un punto de venta no electrónico, sin código de ARCA ni IVA.
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

/** Punto de venta activo (punto_venta.activo). */
export type PuntoVentaActivo = { numero: number; electronico: boolean };

/**
 * Punto de venta para un comprobante nuevo copiado de otro: el mismo si
 * sigue activo y es del tipo que corresponde (no electrónico para un X,
 * electrónico para A o B); si no, el activo de ese tipo de número más bajo.
 */
export function puntoVentaPara(
  actual: number,
  esX: boolean,
  activos: readonly PuntoVentaActivo[],
): { puntoVenta: number } | { error: string } {
  const delTipo = activos
    .filter((p) => p.electronico === !esX)
    .map((p) => Number(p.numero))
    .sort((a, b) => a - b);
  if (delTipo.includes(Number(actual))) return { puntoVenta: Number(actual) };
  if (delTipo.length === 0) {
    return { error: `No hay ningún punto de venta ${esX ? "no electrónico" : "electrónico"} activo.` };
  }
  return { puntoVenta: delTipo[0] };
}

/**
 * @param puntosActivos puntos de venta activos (electrónicos y no electrónicos).
 */
export function armarNota(
  origen: OrigenNota,
  items: readonly ItemGuardado[],
  clase: ClaseComprobante,
  hoy: string,
  puntosActivos: readonly PuntoVentaActivo[],
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
  const esX = origen.letra === "X";
  const punto = puntoVentaPara(origen.punto_venta, esX, puntosActivos);
  if ("error" in punto) return punto;

  // Un X no lleva IVA: cada ítem va con IVA 0 (la base lo exige, CM009).
  const copiados = items.map((i) => (esX ? { ...i, iva: 0 } : { ...i }));
  const totales = calcularTotales(
    copiados.map((i) => ({
      cantidad: Number(i.cantidad),
      precioUnitario: Number(i.precio_unitario),
      descuentoPct: Number(i.descuento_pct),
      alicuotaIva: tasaDeFila(i),
    })),
    { sinIva: esX },
  );

  return {
    cabecera: {
      punto_venta: punto.puntoVenta,
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
