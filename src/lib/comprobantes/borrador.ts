/**
 * Borradores de comprobante: lo que manda la pantalla (textos, tal como se
 * cargaron) y lo que se guarda (números ya validados, con importes y
 * totales calculados acá). Lo usan la pantalla, para el cálculo en vivo, y
 * la acción de guardar, que no confía en los importes del navegador.
 */
import {
  ALICUOTAS_IVA,
  CLASES_COMPROBANTE,
  CONDICIONES_PAGO,
  type AlicuotaIva,
  type ClaseComprobante,
  type CondicionIva,
  type CondicionPago,
  type LetraComprobante,
  type TipoComprobanteArca,
} from "@/lib/tipos";
import {
  leerAsociadoManual,
  letraDeTipoArca,
  validarAsociadosNota,
  type AsociadoGuardado,
  type AsociadoManualEnviado,
} from "./asociados";
import { calcularItem, calcularTotales, type ItemACalcular } from "./calculo";
import { letraYTipoNota } from "./letra";
import { esFechaValida } from "./validacion";

// ----- Lo que manda la pantalla ---------------------------------------------

/** Un renglón tal como está en la pantalla. productoId vacío = ítem libre. */
export type FilaItemEnviada = {
  productoId: string | null;
  descripcion: string;
  observaciones: string;
  cantidad: string;
  precioUnitario: string;
  descuentoPct: string;
  alicuotaIva: string;
};

export type BorradorEnviado = {
  clienteId: string;
  clase: ClaseComprobante;
  /** yyyy-mm-dd */
  fecha: string;
  fechaVencimientoPago: string;
  condicionPago: CondicionPago;
  listaPrecioId: string | null;
  puntoVenta: number | string;
  observaciones: string;
  items: FilaItemEnviada[];
  /**
   * Comprobante asociado cargado a mano (notas sobre comprobantes del
   * sistema anterior). Se ignora si la nota ya tiene un asociado de la base.
   */
  asociadoManual?: AsociadoManualEnviado | null;
};

/** Producto del catálogo, con los datos que se copian al renglón. */
export type ProductoCatalogo = {
  id: string;
  codigo: string;
  nombre: string;
  alicuota_iva: number;
  /** Unidad de venta (o la de costeo si no tiene). */
  unidad: string | null;
};

// ----- Lo que se guarda (parámetros de guardar_borrador_comprobante) -------

export type CabeceraGuardada = {
  punto_venta: number;
  clase: ClaseComprobante;
  letra: LetraComprobante | null;
  tipo_arca: TipoComprobanteArca | null;
  fecha: string;
  fecha_vencimiento_pago: string;
  cliente_id: string;
  lista_precio_id: string | null;
  condicion_pago: CondicionPago;
  observaciones: string | null;
  neto: number;
  iva: number;
  total: number;
};

export type ItemGuardado = {
  producto_id: string | null;
  codigo: string | null;
  descripcion: string;
  observaciones: string | null;
  unidad: string | null;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  alicuota_iva: AlicuotaIva;
  importe: number;
  iva: number;
};

export type BorradorArmado = {
  cabecera: CabeceraGuardada;
  items: ItemGuardado[];
  /** Asociados que reemplazan a los guardados; null: no se tocan (la nota ya tiene uno de la base). */
  asociados: AsociadoGuardado[] | null;
};

// ----- Ayudas para la pantalla ----------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Número de un campo de texto, aceptando coma decimal. null si está vacío o no es un número. */
export function aDecimal(valor: string | number | null | undefined): number | null {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  const texto = (valor ?? "").trim().replace(",", ".");
  if (texto === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/** Redondea a `decimales` (precio y cantidad van con 4). */
function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
}

/**
 * Vencimiento del cobro: con contado, la fecha del comprobante; si no, el
 * elegido, pero nunca vacío ni anterior a la fecha.
 */
export function vencimientoPara(condicion: CondicionPago, fecha: string, vencimiento: string): string {
  if (condicion === "contado" || !esFechaValida(vencimiento) || vencimiento < fecha) return fecha;
  return vencimiento;
}

/** Precio final (sin IVA) por producto de una lista. Si el producto aparece dos veces, vale el primero. */
export function mapaPrecios(
  filas: readonly { producto_id: string | null; precio_final: number | string }[],
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const fila of filas) {
    if (fila.producto_id && !mapa.has(fila.producto_id)) mapa.set(fila.producto_id, Number(fila.precio_final));
  }
  return mapa;
}

/** Precio que se propone al elegir un producto: el de la lista, o 0 si no está. */
export function precioPropuesto(mapa: ReadonlyMap<string, number>, productoId: string): { precio: number; enLista: boolean } {
  const precio = mapa.get(productoId);
  return precio === undefined ? { precio: 0, enLista: false } : { precio, enLista: true };
}

/** La alícuota si es una de las que acepta ARCA; si no, null. */
export function alicuotaArca(valor: number | string | null | undefined): AlicuotaIva | null {
  const n = typeof valor === "number" ? valor : aDecimal(valor);
  return (ALICUOTAS_IVA as readonly number[]).includes(n as number) ? (n as AlicuotaIva) : null;
}

/** Renglón para el cálculo en vivo, o null mientras falte algo. */
export function itemParaCalcular(fila: FilaItemEnviada): ItemACalcular | null {
  const cantidad = aDecimal(fila.cantidad);
  const precio = aDecimal(fila.precioUnitario);
  const descuento = aDecimal(fila.descuentoPct) ?? 0;
  const alicuota = alicuotaArca(fila.alicuotaIva);
  if (cantidad === null || cantidad <= 0 || precio === null || precio < 0 || alicuota === null) return null;
  if (descuento < 0 || descuento > 100) return null;
  return { cantidad, precioUnitario: precio, descuentoPct: descuento, alicuotaIva: alicuota };
}

// ----- Armar lo que se guarda -----------------------------------------------

function texto(valor: unknown): string | null {
  const t = typeof valor === "string" ? valor.trim() : "";
  return t === "" ? null : t;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/**
 * Valida lo enviado por la pantalla y arma la cabecera y los ítems para
 * guardar. Un renglón con producto toma del catálogo código, nombre, unidad
 * y alícuota; uno libre, lo cargado. Importes y totales se calculan acá.
 *
 * Una nota lleva la letra de su asociado (de la base, o el tipo del cargado
 * a mano); sin asociado, la de la condición IVA del cliente.
 */
export function armarBorrador(
  enviado: unknown,
  contexto: {
    productos: ReadonlyMap<string, ProductoCatalogo>;
    condicionIvaCliente: CondicionIva | null;
    /** Asociado de la base que ya tiene la nota (lo puso "Generar nota"). */
    asociadoInterno?: { tipoArca: number } | null;
    /** CUIT del emisor: va en el asociado cargado a mano. */
    cuitEmisor?: string | null;
  },
): { borrador: BorradorArmado } | { errores: string[] } {
  if (!esObjeto(enviado) || !Array.isArray(enviado.items)) {
    return { errores: ["Los datos del comprobante no son válidos."] };
  }
  const errores: string[] = [];

  const clienteId = typeof enviado.clienteId === "string" && UUID.test(enviado.clienteId) ? enviado.clienteId : null;
  if (!clienteId) errores.push("Elegí el cliente.");

  const clase = (CLASES_COMPROBANTE as readonly unknown[]).includes(enviado.clase)
    ? (enviado.clase as ClaseComprobante)
    : null;
  if (!clase) errores.push("Elegí el tipo de comprobante.");

  const fecha = typeof enviado.fecha === "string" && esFechaValida(enviado.fecha) ? enviado.fecha : null;
  if (!fecha) errores.push("La fecha del comprobante no es válida.");

  const condicionPago = (CONDICIONES_PAGO as readonly unknown[]).includes(enviado.condicionPago)
    ? (enviado.condicionPago as CondicionPago)
    : null;
  if (!condicionPago) errores.push("Elegí la condición de pago.");

  const vencimientoEnviado = typeof enviado.fechaVencimientoPago === "string" ? enviado.fechaVencimientoPago : "";
  if (fecha && condicionPago === "cuenta_corriente") {
    if (!esFechaValida(vencimientoEnviado)) errores.push("El vencimiento del cobro no es válido.");
    else if (vencimientoEnviado < fecha) errores.push("El vencimiento del cobro no puede ser anterior a la fecha.");
  }

  const listaPrecioId =
    typeof enviado.listaPrecioId === "string" && UUID.test(enviado.listaPrecioId) ? enviado.listaPrecioId : null;

  const puntoVenta = aDecimal(enviado.puntoVenta as string | number | null);
  if (puntoVenta === null || !Number.isInteger(puntoVenta) || puntoVenta < 1 || puntoVenta > 99999) {
    errores.push("Elegí el punto de venta.");
  }

  const items: ItemGuardado[] = [];
  enviado.items.forEach((valor: unknown, i: number) => {
    const n = `Ítem ${i + 1}`;
    if (!esObjeto(valor)) {
      errores.push(`${n}: los datos no son válidos.`);
      return;
    }
    const erroresAntes = errores.length;

    let datosProducto: Pick<ItemGuardado, "producto_id" | "codigo" | "descripcion" | "unidad"> | null = null;
    let alicuota: AlicuotaIva | null = null;
    if (typeof valor.productoId === "string" && valor.productoId !== "") {
      const producto = contexto.productos.get(valor.productoId);
      if (!producto) {
        errores.push(`${n}: el producto ya no existe.`);
      } else {
        alicuota = alicuotaArca(producto.alicuota_iva);
        if (alicuota === null) {
          errores.push(
            `${n}: el producto ${producto.codigo} tiene una alícuota de IVA (${producto.alicuota_iva}%) que ARCA no acepta. ` +
              "Corregila en el producto.",
          );
        }
        datosProducto = { producto_id: producto.id, codigo: producto.codigo, descripcion: producto.nombre, unidad: producto.unidad };
      }
    } else {
      const descripcion = texto(valor.descripcion);
      if (!descripcion) errores.push(`${n}: completá la descripción.`);
      alicuota = alicuotaArca(valor.alicuotaIva as string);
      if (alicuota === null) errores.push(`${n}: elegí la alícuota de IVA.`);
      datosProducto = { producto_id: null, codigo: null, descripcion: descripcion ?? "", unidad: null };
    }

    const cantidad = aDecimal(valor.cantidad as string);
    if (cantidad === null || redondear(cantidad, 4) <= 0) errores.push(`${n}: la cantidad tiene que ser mayor a cero.`);
    const precio = aDecimal(valor.precioUnitario as string) ?? 0;
    if (precio < 0) errores.push(`${n}: el precio no puede ser negativo.`);
    const descuento = aDecimal(valor.descuentoPct as string) ?? 0;
    if (descuento < 0 || descuento > 100) errores.push(`${n}: el descuento tiene que estar entre 0 y 100.`);

    if (errores.length > erroresAntes || !datosProducto || alicuota === null || cantidad === null) return;

    const calculable = {
      cantidad: redondear(cantidad, 4),
      precioUnitario: redondear(precio, 4),
      descuentoPct: redondear(descuento, 2),
      alicuotaIva: alicuota,
    };
    const { importe, iva } = calcularItem(calculable);
    items.push({
      ...datosProducto,
      observaciones: texto(valor.observaciones),
      cantidad: calculable.cantidad,
      precio_unitario: calculable.precioUnitario,
      descuento_pct: calculable.descuentoPct,
      alicuota_iva: alicuota,
      importe,
      iva,
    });
  });

  // Asociados: el de la base no se toca; el cargado a mano se reemplaza.
  let asociados: AsociadoGuardado[] | null = [];
  let letraAsociado: LetraComprobante | null = null;
  if (clase && contexto.asociadoInterno) {
    const validos = validarAsociadosNota(clase, [contexto.asociadoInterno.tipoArca]);
    if ("error" in validos) errores.push(validos.error);
    else letraAsociado = validos.letra;
    asociados = null;
  } else if (clase && clase !== "factura") {
    const manual = leerAsociadoManual(enviado.asociadoManual, clase, fecha, contexto.cuitEmisor ?? null);
    if ("errores" in manual) errores.push(...manual.errores);
    else if (manual.asociado) {
      asociados = [manual.asociado];
      letraAsociado = letraDeTipoArca((manual.asociado as { tipo_arca: number }).tipo_arca);
    }
  }

  if (errores.length > 0) return { errores };

  let letra: LetraComprobante | null = null;
  let tipoArca: TipoComprobanteArca | null = null;
  if (contexto.condicionIvaCliente || letraAsociado) {
    ({ letra, tipoArca } = letraYTipoNota(contexto.condicionIvaCliente, clase!, letraAsociado));
  }

  const totales = calcularTotales(
    items.map((i) => ({
      cantidad: i.cantidad,
      precioUnitario: i.precio_unitario,
      descuentoPct: i.descuento_pct,
      alicuotaIva: i.alicuota_iva,
    })),
  );

  return {
    borrador: {
      cabecera: {
        punto_venta: puntoVenta!,
        clase: clase!,
        letra,
        tipo_arca: tipoArca,
        fecha: fecha!,
        fecha_vencimiento_pago: vencimientoPara(condicionPago!, fecha!, vencimientoEnviado),
        cliente_id: clienteId!,
        lista_precio_id: listaPrecioId,
        condicion_pago: condicionPago!,
        observaciones: texto(enviado.observaciones),
        neto: totales.neto,
        iva: totales.iva,
        total: totales.total,
      },
      items,
      asociados,
    },
  };
}

// ----- Errores al guardar ---------------------------------------------------

const MENSAJES_GUARDADO: Record<string, string> = {
  CM001: "El comprobante está autorizado: no se puede modificar. Para corregirlo, emití una nota de crédito.",
  CM002: "El comprobante cambió de estado. Recargá la página.",
  CM003: "Sólo se pueden borrar borradores y rechazados.",
  CM004: "El comprobante ya no es un borrador: no se puede modificar. Recargá la página.",
  CM005: "El punto de venta no existe o no coincide con el ambiente de ARCA.",
  CM006: "No se encontró el comprobante. Puede que lo hayan borrado.",
  "23503": "El cliente, la lista de precios o el punto de venta ya no existen. Recargá la página.",
};

/** Mensaje legible de un error de la base al guardar o borrar un borrador. */
export function mensajeErrorGuardado(error: { code?: string; message: string }): string {
  // CM007 (asociado inválido): el mensaje de la base ya es legible y dice qué asociado.
  if (error.code === "CM007") return error.message;
  return (error.code && MENSAJES_GUARDADO[error.code]) || `No se pudo guardar el comprobante: ${error.message}`;
}

// ----- Buscador de productos ------------------------------------------------

function normalizar(valor: string): string {
  return valor.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Productos cuyo código o nombre contiene todas las palabras de `texto`
 * (sin distinguir mayúsculas ni acentos). Primero los que empiezan con el
 * texto en el código.
 */
export function buscarProductos<T extends { codigo: string; nombre: string }>(
  productos: readonly T[],
  texto: string,
  limite = 8,
): T[] {
  const palabras = normalizar(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  const encontrados = productos.filter((p) => {
    const donde = normalizar(`${p.codigo} ${p.nombre}`);
    return palabras.every((palabra) => donde.includes(palabra));
  });
  const inicio = palabras[0];
  return encontrados
    .sort((a, b) => Number(normalizar(b.codigo).startsWith(inicio)) - Number(normalizar(a.codigo).startsWith(inicio)))
    .slice(0, limite);
}
