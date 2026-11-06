/**
 * Facturar remitos de compra: de los renglones pendientes de un proveedor
 * (v_remito_compra_item_pendiente) se eligen cantidades y, con el número de
 * la factura del proveedor, se arma el pedido de
 * facturar_remitos_compra(p_items, p_comprobante), que crea el borrador de
 * factura con el precio vigente sugerido.
 *
 * Las cantidades tienen 4 decimales (numeric(14,4)) y se comparan como
 * enteros escalados. La base vuelve a controlar todo (pendiente con
 * candado, mismo proveedor, remitos recibidos); acá se valida antes para
 * dar mensajes claros.
 */
import { esObjeto, texto } from "@/lib/comprobantes/borrador";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { MAXIMO_NUMERO, MAXIMO_PUNTO_VENTA, enteroEntre } from "@/lib/compras/comprobantes/borrador";
import { desescalar, escalarDecimal } from "@/lib/remitos/decimal";
import { LETRAS_COMPRA, type LetraCompra, type RemitoCompraItemPendiente } from "@/lib/tipos";
import { numeroRemitoCompra } from "./listado";

/** Decimales de una cantidad (numeric(14,4)). */
const DECIMALES_CANTIDAD = 4;

/** Un renglón de remito pendiente en la pantalla de facturación. */
export type RenglonAFacturar = {
  remitoItemId: string;
  remitoId: string;
  proveedorId: string;
  /** 00003-00000123 */
  numeroRemito: string;
  /** yyyy-mm-dd, del remito. */
  fechaRemito: string;
  codigo: string | null;
  descripcion: string;
  unidad: string | null;
  /** Cantidad del remito y lo ya facturado (borradores incluidos). */
  cantidadRemito: number;
  facturada: number;
  /** Lo que queda por facturar (4 decimales). */
  pendiente: number;
  elegido: boolean;
  /** Texto del campo: la cantidad a facturar. */
  cantidad: string;
};

/** Cabecera de la factura tal como la manda la pantalla. */
export type CabeceraFacturaEnviada = {
  letra: string;
  puntoVenta: string;
  numero: string;
  /** yyyy-mm-dd */
  fecha: string;
  /** yyyy-mm-dd o vacío. */
  fechaVencimiento: string;
  observaciones: string;
};

/** Parámetros exactos de la RPC facturar_remitos_compra. */
export type PedidoFacturacionCompra = {
  p_items: { remito_compra_item_id: string; cantidad: number }[];
  p_comprobante: {
    letra: LetraCompra;
    punto_venta: number;
    numero: number;
    fecha: string;
    fecha_vencimiento: string | null;
    observaciones: string | null;
  };
};

const escalar = (valor: number | string) => escalarDecimal(valor, DECIMALES_CANTIDAD) ?? 0n;

function comparar(a: RemitoCompraItemPendiente, b: RemitoCompraItemPendiente): number {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.punto_venta !== b.punto_venta) return Number(a.punto_venta) - Number(b.punto_venta);
  if (a.numero !== b.numero) return Number(a.numero) - Number(b.numero);
  return a.orden - b.orden;
}

/**
 * Selección inicial: cada renglón con algo pendiente de un remito recibido,
 * con todo lo pendiente, ordenados por remito (fecha, punto de venta,
 * número) y renglón. Todos elegidos; desde un remito (`remitoId`), sólo
 * los suyos.
 */
export function seleccionInicial(
  filas: readonly RemitoCompraItemPendiente[],
  remitoId: string | null = null,
): RenglonAFacturar[] {
  return filas
    .filter((f) => f.estado_remito === "recibido" && escalar(f.pendiente) > 0n)
    .sort(comparar)
    .map((f) => {
      const pendiente = desescalar(escalar(f.pendiente), DECIMALES_CANTIDAD);
      return {
        remitoItemId: f.remito_compra_item_id,
        remitoId: f.remito_compra_id,
        proveedorId: f.proveedor_id,
        numeroRemito: numeroRemitoCompra(f),
        fechaRemito: f.fecha,
        codigo: f.codigo_proveedor,
        descripcion: f.descripcion,
        unidad: f.unidad,
        cantidadRemito: Number(f.cantidad),
        facturada: Number(f.facturada),
        pendiente,
        elegido: remitoId === null || f.remito_compra_id === remitoId,
        cantidad: String(pendiente),
      };
    });
}

type CantidadLeida = { cantidad: bigint } | { error: "no_positiva" | "decimales" | "excede" };

function leerCantidad(renglon: RenglonAFacturar): CantidadLeida {
  if (renglon.cantidad.trim() === "") return { error: "no_positiva" };
  const cantidad = escalarDecimal(renglon.cantidad, DECIMALES_CANTIDAD, { exacto: true });
  if (cantidad === null) {
    // Un número con más de 4 decimales; si no es un número, cuenta como cantidad inválida.
    return escalarDecimal(renglon.cantidad, DECIMALES_CANTIDAD) === null ? { error: "no_positiva" } : { error: "decimales" };
  }
  if (cantidad <= 0n) return { error: "no_positiva" };
  if (cantidad > escalar(renglon.pendiente)) return { error: "excede" };
  return { cantidad };
}

function armarCabecera(enviada: unknown): { cabecera: PedidoFacturacionCompra["p_comprobante"] } | { errores: string[] } {
  if (!esObjeto(enviada)) return { errores: ["Los datos de la factura no son válidos."] };
  const errores: string[] = [];
  const letra = (LETRAS_COMPRA as readonly unknown[]).includes(enviada.letra) ? (enviada.letra as LetraCompra) : null;
  if (!letra) errores.push("Elegí la letra de la factura.");
  const puntoVenta = enteroEntre(enviada.puntoVenta, MAXIMO_PUNTO_VENTA);
  if (puntoVenta === null) errores.push("El punto de venta va de 1 a 99999.");
  const numero = enteroEntre(enviada.numero, MAXIMO_NUMERO);
  if (numero === null) errores.push("El número de la factura va de 1 a 99999999.");
  const fecha = typeof enviada.fecha === "string" && esFechaValida(enviada.fecha) ? enviada.fecha : null;
  if (!fecha) errores.push("La fecha de la factura no es válida.");
  const vencimiento = texto(enviada.fechaVencimiento);
  if (vencimiento !== null && !esFechaValida(vencimiento)) errores.push("El vencimiento no es una fecha válida.");
  else if (vencimiento !== null && fecha && vencimiento < fecha) {
    errores.push("El vencimiento no puede ser anterior a la fecha de la factura.");
  }
  if (errores.length > 0) return { errores };
  return {
    cabecera: {
      letra: letra!,
      punto_venta: puntoVenta!,
      numero: numero!,
      fecha: fecha!,
      fecha_vencimiento: vencimiento,
      observaciones: texto(enviada.observaciones),
    },
  };
}

/**
 * Valida lo elegido y la cabecera, y arma el pedido de
 * facturar_remitos_compra. Pide al menos un renglón, un solo proveedor y
 * cantidades mayores que cero, de hasta 4 decimales y no mayores que lo
 * pendiente.
 */
export function armarFacturacion(
  renglones: readonly RenglonAFacturar[],
  cabeceraEnviada: unknown,
): { pedido: PedidoFacturacionCompra } | { errores: string[] } {
  const errores: string[] = [];

  const elegidos = renglones.filter((r) => r.elegido);
  if (elegidos.length === 0) errores.push("Elegí al menos un renglón para facturar.");
  if (new Set(elegidos.map((r) => r.proveedorId)).size > 1) {
    errores.push("Los renglones son de proveedores distintos: una factura junta remitos de un mismo proveedor.");
  }

  const items: PedidoFacturacionCompra["p_items"] = [];
  for (const renglon of elegidos) {
    const n = `${renglon.descripcion} (remito ${renglon.numeroRemito})`;
    const leida = leerCantidad(renglon);
    if ("error" in leida) {
      if (leida.error === "no_positiva") errores.push(`${n}: la cantidad tiene que ser mayor que cero.`);
      if (leida.error === "decimales") errores.push(`${n}: la cantidad admite hasta 4 decimales.`);
      if (leida.error === "excede") {
        errores.push(`${n}: quedan ${renglon.pendiente} pendientes, no se puede facturar ${renglon.cantidad.trim()}.`);
      }
      continue;
    }
    items.push({ remito_compra_item_id: renglon.remitoItemId, cantidad: desescalar(leida.cantidad, DECIMALES_CANTIDAD) });
  }

  const cabecera = armarCabecera(cabeceraEnviada);
  if ("errores" in cabecera) errores.push(...cabecera.errores);

  if (errores.length > 0 || "errores" in cabecera) return { errores };
  return { pedido: { p_items: items, p_comprobante: cabecera.cabecera } };
}

export const MENSAJE_SELECCION_DESACTUALIZADA =
  "Un renglón elegido ya no está pendiente (lo facturaron o anularon el remito). Recargá la página.";

const MENSAJE_DATOS_INVALIDOS = "Los datos de la facturación no son válidos.";

/** Lo que manda la pantalla de cada renglón: si va y cuánto. */
export type SeleccionEnviada = { remitoItemId: string; elegido: boolean; cantidad: string };

/**
 * Aplica lo elegido en la pantalla sobre los pendientes leídos de la base
 * (seleccionInicial en el servidor). Del navegador sólo se toman `elegido`
 * y `cantidad`; lo pendiente y el proveedor salen de la base. Un renglón
 * que la pantalla no manda queda sin elegir; uno elegido que ya no está
 * pendiente pide recargar.
 */
export function aplicarSeleccion(
  base: readonly RenglonAFacturar[],
  enviados: unknown,
): { items: RenglonAFacturar[] } | { error: string } {
  if (!Array.isArray(enviados)) return { error: MENSAJE_DATOS_INVALIDOS };
  const elegidos = new Map<string, { elegido: boolean; cantidad: string }>();
  for (const e of enviados) {
    if (!esObjeto(e)) return { error: MENSAJE_DATOS_INVALIDOS };
    const { remitoItemId, elegido, cantidad } = e;
    if (typeof remitoItemId !== "string" || typeof elegido !== "boolean" || typeof cantidad !== "string") {
      return { error: MENSAJE_DATOS_INVALIDOS };
    }
    elegidos.set(remitoItemId, { elegido, cantidad });
  }
  const ids = new Set(base.map((r) => r.remitoItemId));
  for (const [id, { elegido }] of elegidos) {
    if (elegido && !ids.has(id)) return { error: MENSAJE_SELECCION_DESACTUALIZADA };
  }
  return {
    items: base.map((renglon) => {
      const enviado = elegidos.get(renglon.remitoItemId);
      return enviado ? { ...renglon, ...enviado } : { ...renglon, elegido: false };
    }),
  };
}

/** Renglones de un mismo remito, para mostrarlos juntos. */
export type GrupoRemitoCompra = { remitoId: string; numeroRemito: string; fechaRemito: string; items: RenglonAFacturar[] };

/** Agrupa por remito, respetando el orden en que llegan (el de seleccionInicial). */
export function agruparPorRemito(renglones: readonly RenglonAFacturar[]): GrupoRemitoCompra[] {
  const grupos = new Map<string, GrupoRemitoCompra>();
  for (const renglon of renglones) {
    let grupo = grupos.get(renglon.remitoId);
    if (!grupo) {
      grupo = { remitoId: renglon.remitoId, numeroRemito: renglon.numeroRemito, fechaRemito: renglon.fechaRemito, items: [] };
      grupos.set(renglon.remitoId, grupo);
    }
    grupo.items.push(renglon);
  }
  return [...grupos.values()];
}
