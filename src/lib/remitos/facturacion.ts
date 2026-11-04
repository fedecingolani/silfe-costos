/**
 * Facturación de remitos: de los ítems pendientes de un cliente
 * (v_remito_item_pendiente) se eligen cantidades y se arma el pedido de
 * facturar_remitos(p_items, p_punto_venta), que crea el borrador de factura.
 *
 * Las cantidades tienen 4 decimales (numeric(14,4)) y se comparan como
 * enteros escalados, sin coma flotante. La base vuelve a controlar todo
 * (pendiente con candado, mismo cliente, remitos emitidos); acá se valida
 * antes para dar mensajes claros, incluido el de un cliente sin condición
 * de IVA en un punto electrónico, que la base dejaría sin letra.
 */
import { calcularTotales, type ItemACalcular, type OpcionesCalculo, type Totales } from "@/lib/comprobantes/calculo";
import { NO_GRAVADO, type AlicuotaIva, type CondicionIva, type PuntoVenta, type RemitoItemPendiente } from "@/lib/tipos";
import { desescalar, escalarDecimal } from "./decimal";
import { numeroRemito } from "./numero";

/** Decimales de una cantidad (numeric(14,4)). */
const DECIMALES_CANTIDAD = 4;

/** Un ítem de remito pendiente en la pantalla de facturación. */
export type ItemAFacturar = {
  remitoItemId: string;
  remitoId: string;
  clienteId: string;
  /** R-00001-00000001 */
  numeroRemito: string;
  /** yyyy-mm-dd, del remito. */
  fechaRemito: string;
  codigo: string | null;
  descripcion: string;
  unidad: string | null;
  precioUnitario: number;
  descuentoPct: number;
  gravado: boolean;
  alicuotaIva: AlicuotaIva | null;
  /** Lo que queda por facturar (4 decimales). */
  pendiente: number;
  elegido: boolean;
  /** Texto del campo: la cantidad a facturar. */
  cantidad: string;
};

/** Parámetros exactos de la RPC facturar_remitos. */
export type PedidoFacturacion = {
  p_items: { remito_item_id: string; cantidad: number }[];
  p_punto_venta: number;
};

export const MENSAJE_CLIENTE_SIN_CONDICION_IVA =
  "El cliente no tiene condición de IVA: cargala en el cliente para facturar en un punto de venta electrónico (define la letra A o B).";

function comparar(a: RemitoItemPendiente, b: RemitoItemPendiente): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.punto_venta !== b.punto_venta) return a.punto_venta - b.punto_venta;
  if (a.numero !== b.numero) return Number(a.numero) - Number(b.numero);
  return a.orden - b.orden;
}

/**
 * Selección inicial: cada ítem con algo pendiente de un remito emitido,
 * elegido con todo lo pendiente. Ordenados por remito (fecha, punto de
 * venta, número) y por renglón.
 */
export function seleccionInicial(filas: readonly RemitoItemPendiente[]): ItemAFacturar[] {
  return filas
    .filter((f) => f.estado_remito === "emitido" && f.numero !== null && (escalarDecimal(f.pendiente, DECIMALES_CANTIDAD) ?? 0n) > 0n)
    .sort(comparar)
    .map((f) => {
      const pendiente = desescalar(escalarDecimal(f.pendiente, DECIMALES_CANTIDAD)!, DECIMALES_CANTIDAD);
      return {
        remitoItemId: f.remito_item_id,
        remitoId: f.remito_id,
        clienteId: f.cliente_id,
        numeroRemito: numeroRemito(f.punto_venta, f.numero!),
        fechaRemito: f.fecha,
        codigo: f.codigo,
        descripcion: f.descripcion,
        unidad: f.unidad,
        precioUnitario: Number(f.precio_unitario),
        descuentoPct: Number(f.descuento_pct),
        gravado: f.gravado,
        alicuotaIva: f.alicuota_iva === null ? null : (Number(f.alicuota_iva) as AlicuotaIva),
        pendiente,
        elegido: true,
        cantidad: String(pendiente),
      };
    });
}

type CantidadLeida = { cantidad: bigint } | { error: "no_positiva" | "decimales" | "excede" };

function leerCantidad(item: ItemAFacturar): CantidadLeida {
  if (item.cantidad.trim() === "") return { error: "no_positiva" };
  const cantidad = escalarDecimal(item.cantidad, DECIMALES_CANTIDAD, { exacto: true });
  if (cantidad === null) {
    // Un número con más de 4 decimales; si no es un número, cuenta como cantidad inválida.
    return escalarDecimal(item.cantidad, DECIMALES_CANTIDAD) === null ? { error: "no_positiva" } : { error: "decimales" };
  }
  if (cantidad <= 0n) return { error: "no_positiva" };
  if (cantidad > (escalarDecimal(item.pendiente, DECIMALES_CANTIDAD) ?? 0n)) return { error: "excede" };
  return { cantidad };
}

function aCalcular(item: ItemAFacturar, cantidad: bigint): ItemACalcular {
  return {
    cantidad: desescalar(cantidad, DECIMALES_CANTIDAD),
    precioUnitario: item.precioUnitario,
    descuentoPct: item.descuentoPct,
    alicuotaIva: item.gravado && item.alicuotaIva !== null ? item.alicuotaIva : NO_GRAVADO,
  };
}

/**
 * Subtotal en vivo de lo elegido, como lo calcula la factura. Ignora los
 * renglones no elegidos y las cantidades inválidas o que exceden lo
 * pendiente. sinIva: punto de venta no electrónico (factura X).
 */
export function subtotalFacturacion(items: readonly ItemAFacturar[], opciones: OpcionesCalculo = {}): Totales {
  const calculables: ItemACalcular[] = [];
  for (const item of items) {
    if (!item.elegido) continue;
    const leida = leerCantidad(item);
    if ("cantidad" in leida) calculables.push(aCalcular(item, leida.cantidad));
  }
  return calcularTotales(calculables, opciones);
}

/**
 * Valida lo elegido y arma el pedido de facturar_remitos, con el subtotal
 * de la factura que va a generar. Pide punto de venta activo, al menos un
 * ítem, un solo cliente, cantidades mayores que cero, de hasta 4 decimales
 * y no mayores que lo pendiente, y, en un punto electrónico, que el cliente
 * tenga condición de IVA (sin ella la factura quedaría sin letra).
 */
export function armarFacturacion(
  items: readonly ItemAFacturar[],
  contexto: {
    puntoVenta: Pick<PuntoVenta, "numero" | "electronico" | "activo"> | null;
    condicionIvaCliente: CondicionIva | null;
  },
): { pedido: PedidoFacturacion; totales: Totales } | { errores: string[] } {
  const errores: string[] = [];
  const puntoVenta = contexto.puntoVenta?.activo ? contexto.puntoVenta : null;
  if (!puntoVenta) errores.push("Elegí el punto de venta de la factura.");

  const elegidos = items.filter((i) => i.elegido);
  if (elegidos.length === 0) errores.push("Elegí al menos un ítem para facturar.");
  if (new Set(elegidos.map((i) => i.clienteId)).size > 1) {
    errores.push("Los ítems son de clientes distintos: una factura junta remitos de un mismo cliente.");
  }
  if (puntoVenta?.electronico && !contexto.condicionIvaCliente) errores.push(MENSAJE_CLIENTE_SIN_CONDICION_IVA);

  const pedidos: PedidoFacturacion["p_items"] = [];
  const calculables: ItemACalcular[] = [];
  for (const item of elegidos) {
    const n = `${item.descripcion} (${item.numeroRemito})`;
    const leida = leerCantidad(item);
    if ("error" in leida) {
      if (leida.error === "no_positiva") errores.push(`${n}: la cantidad tiene que ser mayor a cero.`);
      if (leida.error === "decimales") errores.push(`${n}: la cantidad admite hasta 4 decimales.`);
      if (leida.error === "excede") {
        errores.push(`${n}: quedan ${item.pendiente} pendientes, no se puede facturar ${item.cantidad.trim()}.`);
      }
      continue;
    }
    pedidos.push({ remito_item_id: item.remitoItemId, cantidad: desescalar(leida.cantidad, DECIMALES_CANTIDAD) });
    calculables.push(aCalcular(item, leida.cantidad));
  }

  if (errores.length > 0) return { errores };
  return {
    pedido: { p_items: pedidos, p_punto_venta: puntoVenta!.numero },
    totales: calcularTotales(calculables, { sinIva: !puntoVenta!.electronico }),
  };
}

export const MENSAJE_SELECCION_DESACTUALIZADA =
  "Un ítem elegido ya no está pendiente (lo facturaron o cambió el remito). Recargá la página.";

const MENSAJE_DATOS_INVALIDOS = "Los datos de la facturación no son válidos.";

/** Lo que manda la pantalla de cada renglón: si va y cuánto. */
export type SeleccionEnviada = { remitoItemId: string; elegido: boolean; cantidad: string };

/**
 * Aplica lo elegido en la pantalla sobre los pendientes leídos de la base
 * (seleccionInicial en el servidor). Del navegador sólo se toman `elegido`
 * y `cantidad`: precio, alícuota, pendiente y cliente salen de la base. Un
 * renglón que la pantalla no manda queda sin elegir; uno elegido que ya no
 * está pendiente pide recargar.
 */
export function aplicarSeleccion(
  base: readonly ItemAFacturar[],
  enviados: unknown,
): { items: ItemAFacturar[] } | { error: string } {
  if (!Array.isArray(enviados)) return { error: MENSAJE_DATOS_INVALIDOS };
  const elegidos = new Map<string, { elegido: boolean; cantidad: string }>();
  for (const e of enviados) {
    if (typeof e !== "object" || e === null) return { error: MENSAJE_DATOS_INVALIDOS };
    const { remitoItemId, elegido, cantidad } = e as Record<string, unknown>;
    if (typeof remitoItemId !== "string" || typeof elegido !== "boolean" || typeof cantidad !== "string") {
      return { error: MENSAJE_DATOS_INVALIDOS };
    }
    elegidos.set(remitoItemId, { elegido, cantidad });
  }
  const ids = new Set(base.map((i) => i.remitoItemId));
  for (const [id, { elegido }] of elegidos) {
    if (elegido && !ids.has(id)) return { error: MENSAJE_SELECCION_DESACTUALIZADA };
  }
  return {
    items: base.map((item) => {
      const enviado = elegidos.get(item.remitoItemId);
      return enviado ? { ...item, elegido: enviado.elegido, cantidad: enviado.cantidad } : { ...item, elegido: false };
    }),
  };
}

/** Renglones de un mismo remito, para mostrarlos juntos. */
export type GrupoRemito = { remitoId: string; numeroRemito: string; fechaRemito: string; items: ItemAFacturar[] };

/** Agrupa por remito, respetando el orden en que llegan (el de seleccionInicial). */
export function agruparPorRemito(items: readonly ItemAFacturar[]): GrupoRemito[] {
  const grupos = new Map<string, GrupoRemito>();
  for (const item of items) {
    let grupo = grupos.get(item.remitoId);
    if (!grupo) {
      grupo = { remitoId: item.remitoId, numeroRemito: item.numeroRemito, fechaRemito: item.fechaRemito, items: [] };
      grupos.set(item.remitoId, grupo);
    }
    grupo.items.push(item);
  }
  return [...grupos.values()];
}
