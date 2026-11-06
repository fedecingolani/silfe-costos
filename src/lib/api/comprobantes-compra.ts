/**
 * Validación pura de `POST /api/v1/comprobantes-compra` (contrato en
 * odd/tasks/api-compras.md). Arma los parámetros de
 * guardar_comprobante_compra con las mismas reglas que la pantalla
 * (armarComprobanteCompra), con tres diferencias:
 *   - cada renglón va como artículo nuevo sin materia prima
 *     (articulo_nuevo): la base lo busca en el catálogo del proveedor por
 *     código o descripción y, si no está, lo crea (fn_compras_articulo).
 *     La materia prima se asocia al revisar el borrador, antes de confirmar;
 *   - en letras B y C se descarta la alícuota (no discriminan IVA): la
 *     integración la manda igual y la base la rechazaría (CP009);
 *   - la cabecera lleva cae, cae_vencimiento y origen = 'api'.
 */
import {
  armarComprobanteCompra,
  type CabeceraCompraGuardada,
  type ItemCompraGuardado,
  type PercepcionGuardada,
} from "@/lib/compras/comprobantes/borrador";
import { discriminaIva } from "@/lib/compras/comprobantes/letra";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { validarCuit } from "@/lib/proveedores/validacion";
import { ALICUOTAS_IVA, LETRAS_COMPRA, NO_GRAVADO, type LetraCompra, type OrigenComprobanteCompra } from "@/lib/tipos";
import { esObjetoPlano } from "./proveedores";

/** p_comprobante de la API: la cabecera de la pantalla más CAE y origen. */
export type CabeceraCompraApi = CabeceraCompraGuardada & {
  cae: string | null;
  cae_vencimiento: string | null;
  origen: OrigenComprobanteCompra;
};

export type ComprobanteApiValidado = {
  /** CUIT del proveedor, sólo dígitos. */
  cuit: string;
  comprobante: Omit<CabeceraCompraApi, "proveedor_id">;
  items: ItemCompraGuardado[];
  percepciones: PercepcionGuardada[];
};

export type ParametrosComprobanteApi = {
  p_id: null;
  p_comprobante: CabeceraCompraApi;
  p_items: ItemCompraGuardado[];
  p_percepciones: PercepcionGuardada[];
};

const CAE = /^[0-9]{14}$/;
const ALICUOTAS_TEXTO = `${ALICUOTAS_IVA.slice(0, -1).join(", ")} o ${ALICUOTAS_IVA[ALICUOTAS_IVA.length - 1]}`;

// armarComprobanteCompra pide el id del proveedor, que se busca por CUIT
// después de validar (sin ir a la base si el pedido está mal). Se le pasa
// este y se reemplaza en parametrosComprobanteApi.
const PROVEEDOR_PENDIENTE = "00000000-0000-4000-8000-000000000000";

function campoOpcional(valor: unknown): unknown {
  return valor === undefined ? null : valor;
}

function esAlicuotaValida(valor: unknown): boolean {
  return valor === null || valor === undefined || (ALICUOTAS_IVA as readonly unknown[]).includes(valor);
}

/** Lo que manda la pantalla, armado desde un renglón de la API (siempre un renglón libre para armarComprobanteCompra). */
function renglonEnviado(item: unknown, conIva: boolean) {
  const r = esObjetoPlano(item) ? item : {};
  return {
    modo: "libre",
    articuloId: null,
    codigo: r.codigo ?? "",
    descripcion: r.descripcion ?? "",
    unidad: r.unidad ?? "",
    materiaPrimaId: "",
    factor: "1",
    cantidad: r.cantidad,
    precioUnitario: r.precio_unitario,
    descuentoPct: r.descuento_pct ?? "",
    alicuotaIva: conIva ? (r.alicuota_iva ?? NO_GRAVADO) : NO_GRAVADO,
    exento: false,
    remitoItemId: null,
  };
}

export function validarComprobanteApi(cuerpo: unknown): ComprobanteApiValidado | { errores: string[] } {
  if (!esObjetoPlano(cuerpo)) return { errores: ["El cuerpo tiene que ser un objeto JSON."] };
  const errores: string[] = [];

  const proveedor = esObjetoPlano(cuerpo.proveedor) ? cuerpo.proveedor : {};
  let cuit: string | null = null;
  if (typeof proveedor.cuit !== "string" || proveedor.cuit.trim() === "") {
    errores.push("proveedor.cuit: es obligatorio.");
  } else {
    const validado = validarCuit(proveedor.cuit);
    if ("error" in validado) errores.push(`proveedor.cuit: ${validado.error}`);
    else cuit = validado.datos;
  }

  const caeTexto = typeof cuerpo.cae === "string" ? cuerpo.cae.trim() : cuerpo.cae;
  const cae = caeTexto === null || caeTexto === undefined || caeTexto === "" ? null : caeTexto;
  if (cae !== null && (typeof cae !== "string" || !CAE.test(cae))) errores.push("cae: tiene que tener 14 dígitos.");

  const caeVencimiento = cuerpo.cae_vencimiento === undefined || cuerpo.cae_vencimiento === "" ? null : cuerpo.cae_vencimiento;
  if (caeVencimiento !== null && !esFechaValida(caeVencimiento as string)) {
    errores.push("cae_vencimiento: no es una fecha válida (aaaa-mm-dd).");
  }

  const items = cuerpo.items;
  if (!Array.isArray(items)) errores.push("items: tiene que ser una lista.");
  else if (items.length === 0) errores.push("items: tiene que tener al menos un renglón.");
  const percepciones = campoOpcional(cuerpo.percepciones) ?? [];
  if (!Array.isArray(percepciones)) errores.push("percepciones: tiene que ser una lista.");

  const listaItems = Array.isArray(items) ? items : [];
  listaItems.forEach((item, i) => {
    if (esObjetoPlano(item) && !esAlicuotaValida(item.alicuota_iva)) {
      errores.push(`items[${i}].alicuota_iva: tiene que ser ${ALICUOTAS_TEXTO}.`);
    }
  });
  if (errores.length > 0) return { errores };

  const letra = (LETRAS_COMPRA as readonly unknown[]).includes(cuerpo.letra) ? (cuerpo.letra as LetraCompra) : null;
  const conIva = letra === null || discriminaIva(letra);
  const armado = armarComprobanteCompra({
    proveedorId: PROVEEDOR_PENDIENTE,
    tipo: cuerpo.tipo,
    letra: cuerpo.letra,
    puntoVenta: cuerpo.punto_venta,
    numero: cuerpo.numero,
    fecha: cuerpo.fecha,
    fechaVencimiento: campoOpcional(cuerpo.fecha_vencimiento) ?? "",
    observaciones: null,
    comprobanteAsociadoId: "",
    renglones: listaItems.map((item) => renglonEnviado(item, conIva)),
    percepciones: (percepciones as unknown[]).map((p) => (esObjetoPlano(p) ? p : {})),
  });
  if ("errores" in armado) return { errores: armado.errores };

  // Validado arriba: cae y cae_vencimiento son null o texto válido.
  const { proveedor_id: _pendiente, ...cabecera } = armado.armado.comprobante;
  void _pendiente;
  return {
    cuit: cuit!,
    comprobante: {
      ...cabecera,
      cae: cae as string | null,
      cae_vencimiento: caeVencimiento as string | null,
      origen: "api",
    },
    items: armado.armado.items.map((item) => ({
      articulo_nuevo: {
        codigo: item.codigo_proveedor,
        descripcion: item.descripcion.trim(),
        unidad: item.unidad,
        factor_conversion: 1,
        materia_prima_id: null,
      },
      ...item,
    })),
    percepciones: armado.armado.percepciones,
  };
}

/** Parámetros exactos de guardar_comprobante_compra para un comprobante nuevo del proveedor encontrado. */
export function parametrosComprobanteApi(validado: ComprobanteApiValidado, proveedorId: string): ParametrosComprobanteApi {
  return {
    p_id: null,
    p_comprobante: { proveedor_id: proveedorId, ...validado.comprobante },
    p_items: validado.items,
    p_percepciones: validado.percepciones,
  };
}

/**
 * Si un error de la base al guardar es por los datos del pedido (→ 422) y no
 * del servidor (→ 500): los errores propios de compras (CPxxx, RCxxx), los
 * controles y claves foráneas de las tablas y los valores que no entran en
 * la columna (texto inválido, número o fecha fuera de rango).
 */
export function esErrorDeDatos(code: string | null | undefined): boolean {
  if (!code) return false;
  return /^(CP|RC)[0-9]{3}$/.test(code) || ["23514", "23503", "22P02", "22003", "22007", "22008"].includes(code);
}
