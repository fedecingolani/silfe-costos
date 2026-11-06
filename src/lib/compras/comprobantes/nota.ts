/**
 * Notas de crédito y débito de compra asociadas a una factura. Desde una
 * factura confirmada se abre una nota con sus renglones y precios ya
 * cargados para ajustarlos; una nota suelta se carga a mano. Las notas no
 * actualizan precios de costeo (ver 20261105000006_compras_notas_asociadas.sql).
 */
import { esUuid } from "@/lib/comprobantes/borrador";
import type { ComprobanteCompra, ComprobanteCompraItem, TipoComprobanteCompra } from "@/lib/tipos";
import { editorDeComprobanteCompra, type EditorComprobanteCompra } from "./borrador";

export const TIPOS_NOTA_COMPRA = ["nota_credito", "nota_debito"] as const;

export type TipoNotaCompra = (typeof TIPOS_NOTA_COMPRA)[number];

export function esNotaCompra(tipo: unknown): tipo is TipoNotaCompra {
  return (TIPOS_NOTA_COMPRA as readonly unknown[]).includes(tipo);
}

/**
 * Al confirmar, una factura elige qué precios de materias primas actualiza;
 * una nota se confirma sin precios (la base la rechaza con CP013).
 */
export function confirmaConPrecios(tipo: TipoComprobanteCompra): boolean {
  return !esNotaCompra(tipo);
}

/** Sólo una factura confirmada recibe notas asociadas. */
export function puedeTenerNotas(comprobante: Pick<ComprobanteCompra, "tipo" | "estado">): boolean {
  return comprobante.tipo === "factura" && comprobante.estado === "confirmado";
}

/** Factura que se ofrece para asociar a una nota. */
export type FacturaAsociable = Pick<
  ComprobanteCompra,
  "id" | "tipo" | "letra" | "punto_venta" | "numero" | "fecha" | "total"
>;

/** Nota asociada que se lista en el detalle de su factura. */
export type NotaAsociada = Pick<
  ComprobanteCompra,
  "id" | "tipo" | "letra" | "punto_venta" | "numero" | "fecha" | "total" | "estado"
>;

function primero(valor: unknown): unknown {
  return Array.isArray(valor) ? valor[0] : valor;
}

/**
 * ?desde=<factura>&tipo=nota_credito|nota_debito de la dirección de un
 * comprobante nuevo. Inválido o incompleto: null (comprobante nuevo común).
 */
export function notaDesdeParametros(desde: unknown, tipo: unknown): { facturaId: string; tipo: TipoNotaCompra } | null {
  const facturaId = primero(desde);
  const tipoNota = primero(tipo);
  if (!esUuid(facturaId) || !esNotaCompra(tipoNota)) return null;
  return { facturaId, tipo: tipoNota };
}

/**
 * Editor de una nota nueva asociada a una factura: mismo proveedor y letra,
 * los renglones con sus precios (artículo o libre, como en la factura) para
 * ajustarlos, sin percepciones, sin número y con fecha de hoy.
 */
export function editorNotaDeFactura(
  factura: ComprobanteCompra,
  items: readonly ComprobanteCompraItem[],
  tipo: TipoNotaCompra,
  hoy: string,
): EditorComprobanteCompra {
  const base = editorDeComprobanteCompra(factura, items, []);
  return {
    ...base,
    tipo,
    puntoVenta: "",
    numero: "",
    fecha: hoy,
    fechaVencimiento: "",
    observaciones: "",
    comprobanteAsociadoId: factura.id,
    percepciones: [],
  };
}

/**
 * Aviso de la factura asociada de una nota que no está entre las ofrecidas:
 * - no_confirmada: se anuló (o no es una factura confirmada);
 * - inexistente: no se encontró (se borró);
 * - sin_datos: no se pudo leer, no se sabe cómo está.
 */
export type AvisoFacturaAsociada = "no_confirmada" | "inexistente" | "sin_datos";

/**
 * Opciones y aviso del selector «Factura asociada» del editor de una nota.
 * La lista de facturas asociables tiene un tope (las más nuevas) y puede
 * venir vacía si falló la lectura; por eso la asociada se lee aparte:
 * @param valor la factura elegida ("" si ninguna).
 * @param facturas las facturas asociables leídas.
 * @param asociada la factura asociada leída por id: null si no existe,
 *   undefined si no se leyó (o falló la lectura).
 * Una asociada confirmada que no está en la lista se agrega primera; el
 * aviso sale sólo si de verdad no está confirmada, no existe o no se sabe.
 */
export function facturaAsociadaEnEditor(
  valor: string,
  facturas: readonly FacturaAsociable[],
  asociada: NotaAsociada | null | undefined,
): { opciones: FacturaAsociable[]; aviso: AvisoFacturaAsociada | null } {
  const opciones = [...facturas];
  if (valor === "" || facturas.some((f) => f.id === valor)) return { opciones, aviso: null };
  if (asociada === null) return { opciones, aviso: "inexistente" };
  if (!asociada || asociada.id !== valor) return { opciones, aviso: "sin_datos" };
  if (asociada.tipo !== "factura" || asociada.estado !== "confirmado") return { opciones, aviso: "no_confirmada" };
  const { id, tipo, letra, punto_venta, numero, fecha, total } = asociada;
  return { opciones: [{ id, tipo, letra, punto_venta, numero, fecha, total }, ...opciones], aviso: null };
}
