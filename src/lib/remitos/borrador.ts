/**
 * Remitos: lo que manda la pantalla y lo que se guarda con
 * guardar_remito(p_id, p_remito, p_items). Los ítems, importes y totales se
 * arman igual que en un comprobante (mismas funciones); el remito suma
 * bultos por ítem, valor declarado, transporte y domicilio de entrega, y no
 * lleva letra, clase ni nada de ARCA.
 */
import {
  armarItems,
  erroresVencimiento,
  esObjeto,
  esUuid,
  texto,
  totalesDeItems,
  vencimientoPara,
  type ItemGuardado,
  type ProductoCatalogo,
} from "@/lib/comprobantes/borrador";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { filaDeItem, filaEnviada, filaVacia, type FilaItem, type ProductoVendible } from "@/lib/ventas/filas";
import { CONDICIONES_PAGO, type CondicionPago, type Remito, type RemitoItem } from "@/lib/tipos";
import { desescalar, escalarDecimal } from "./decimal";
import {
  MENSAJE_VALOR_DECLARADO_INVALIDO,
  leerBultos,
  leerPuntoVenta,
  leerValorDeclarado,
  mensajeBultosInvalidos,
  valorDeclaradoSugerido,
  type FilaItemRemitoEnviada,
  type ValorDeclarado,
} from "./editor";

// ----- Lo que manda la pantalla ---------------------------------------------

export type RemitoEnviado = {
  clienteId: string;
  puntoVenta: number | string;
  /** yyyy-mm-dd */
  fecha: string;
  fechaVencimientoPago: string;
  condicionPago: CondicionPago;
  listaPrecioId: string | null;
  /** Vacío: sin transporte. */
  transporteId: string | null;
  domicilioEntrega: string;
  observaciones: string;
  /** Texto del campo. Vacío: la suma de los importes. */
  valorDeclarado: string;
  items: FilaItemRemitoEnviada[];
};

// ----- Lo que se guarda (parámetros de guardar_remito) ----------------------

/** p_remito de guardar_remito: mismas claves que lee la función. */
export type CabeceraRemitoGuardada = {
  punto_venta: number;
  cliente_id: string;
  fecha: string;
  fecha_vencimiento_pago: string;
  condicion_pago: CondicionPago;
  lista_precio_id: string | null;
  transporte_id: string | null;
  domicilio_entrega: string | null;
  observaciones: string | null;
  valor_declarado: number;
  neto: number;
  no_gravado: number;
  iva: number;
  total: number;
};

/** Un elemento de p_items: las columnas de un ítem de comprobante más los bultos. */
export type ItemRemitoGuardado = ItemGuardado & { bultos: number };

export type RemitoArmado = {
  cabecera: CabeceraRemitoGuardada;
  items: ItemRemitoGuardado[];
};

/** Parámetros de la RPC guardar_remito. p_id null crea un borrador. */
export type ParametrosGuardarRemito = {
  p_id: string | null;
  p_remito: CabeceraRemitoGuardada;
  p_items: ItemRemitoGuardado[];
};

// ----- Armar lo que se guarda -----------------------------------------------

/** Índice del renglón de un error «Ítem N: …» (para ordenar los errores por renglón). */
function renglonDelError(error: string): number {
  const coincidencia = /^Ítem (\d+):/.exec(error);
  return coincidencia ? Number(coincidencia[1]) : 0;
}

/** Suma de los importes en centavos, sin coma flotante. */
function sumaDeImportes(items: readonly { importe: number }[]): number {
  return desescalar(
    items.reduce((total, item) => total + (escalarDecimal(item.importe, 2) ?? 0n), 0n),
    2,
  );
}

/**
 * Valida lo enviado por la pantalla y arma la cabecera y los ítems para
 * guardar_remito. Ítems, importes, totales y vencimiento del cobro siguen
 * las reglas de la factura (el IVA se calcula siempre: el remito no tiene
 * letra). Además pide cliente, punto de venta, al menos un ítem, bultos
 * enteros 0 o más y un valor declarado 0 o más (vacío: la suma de los
 * importes de los ítems).
 */
export function armarRemito(
  enviado: unknown,
  contexto: { productos: ReadonlyMap<string, ProductoCatalogo> },
): { remito: RemitoArmado } | { errores: string[] } {
  if (!esObjeto(enviado) || !Array.isArray(enviado.items)) {
    return { errores: ["Los datos del remito no son válidos."] };
  }
  const errores: string[] = [];

  const clienteId = esUuid(enviado.clienteId) ? enviado.clienteId : null;
  if (!clienteId) errores.push("Elegí el cliente.");

  const puntoVenta = leerPuntoVenta(enviado.puntoVenta);
  if (puntoVenta === null) errores.push("Elegí el punto de venta.");

  const fecha = typeof enviado.fecha === "string" && esFechaValida(enviado.fecha) ? enviado.fecha : null;
  if (!fecha) errores.push("La fecha del remito no es válida.");

  const condicionPago = (CONDICIONES_PAGO as readonly unknown[]).includes(enviado.condicionPago)
    ? (enviado.condicionPago as CondicionPago)
    : null;
  if (!condicionPago) errores.push("Elegí la condición de pago.");

  const vencimientoEnviado = typeof enviado.fechaVencimientoPago === "string" ? enviado.fechaVencimientoPago : "";
  if (fecha && condicionPago) errores.push(...erroresVencimiento(condicionPago, fecha, vencimientoEnviado));

  const listaPrecioId = esUuid(enviado.listaPrecioId) ? enviado.listaPrecioId : null;
  const transporteId = esUuid(enviado.transporteId) ? enviado.transporteId : null;

  if (enviado.items.length === 0) errores.push("Agregá al menos un ítem.");
  const { items, errores: erroresItems } = armarItems(enviado.items, contexto.productos);
  const bultos = enviado.items.map((valor: unknown) => leerBultos(esObjeto(valor) ? valor.bultos : undefined));
  const erroresBultos = bultos.flatMap((b, i) => (b === null ? [mensajeBultosInvalidos(i)] : []));
  // Los errores de los renglones, en el orden de los renglones (sort es estable).
  errores.push(...[...erroresBultos, ...erroresItems].sort((a, b) => renglonDelError(a) - renglonDelError(b)));

  const valorEnviado = typeof enviado.valorDeclarado === "string" ? enviado.valorDeclarado : "";
  const valorDeclarado = leerValorDeclarado(valorEnviado, sumaDeImportes(items));
  if (valorDeclarado === null) errores.push(MENSAJE_VALOR_DECLARADO_INVALIDO);

  if (errores.length > 0) return { errores };

  // Sin errores, armarItems devolvió un ítem por renglón, en el mismo orden.
  const totales = totalesDeItems(items);
  return {
    remito: {
      cabecera: {
        punto_venta: puntoVenta!,
        cliente_id: clienteId!,
        fecha: fecha!,
        fecha_vencimiento_pago: vencimientoPara(condicionPago!, fecha!, vencimientoEnviado),
        condicion_pago: condicionPago!,
        lista_precio_id: listaPrecioId,
        transporte_id: transporteId,
        domicilio_entrega: texto(enviado.domicilioEntrega),
        observaciones: texto(enviado.observaciones),
        valor_declarado: valorDeclarado!,
        neto: totales.neto,
        no_gravado: totales.noGravado,
        iva: totales.iva,
        total: totales.total,
      },
      items: items.map((item, i) => ({ ...item, bultos: bultos[i]! })),
    },
  };
}

/** Parámetros exactos de guardar_remito. id null: remito nuevo (borrador). */
export function parametrosGuardarRemito(id: string | null, remito: RemitoArmado): ParametrosGuardarRemito {
  return { p_id: id, p_remito: remito.cabecera, p_items: remito.items };
}

// ----- Estado del editor ----------------------------------------------------

/** Renglón en pantalla: el de ventas más los bultos (texto). */
export type FilaItemRemito = FilaItem & { bultos: string };

/** Estado del editor de remitos. */
export type EditorRemito = {
  clienteId: string;
  /** Número del punto de venta, como texto del selector. */
  puntoVenta: string;
  fecha: string;
  fechaVencimientoPago: string;
  condicionPago: CondicionPago;
  listaPrecioId: string | null;
  /** Vacío: sin transporte. */
  transporteId: string;
  domicilioEntrega: string;
  observaciones: string;
  valorDeclarado: ValorDeclarado;
  filas: FilaItemRemito[];
};

/** Renglón vacío del editor de remitos (sin bultos). */
export function filaRemitoVacia(): FilaItemRemito {
  return { ...filaVacia(), bultos: "0" };
}

/** Lo que se envía de un renglón (sin los datos que sólo sirven para mostrar). */
export function filaRemitoEnviada(fila: FilaItemRemito): FilaItemRemitoEnviada {
  return { ...filaEnviada(fila), bultos: fila.bultos };
}

/** Lo que manda el editor a la acción de guardar. */
export function remitoEnviado(editor: EditorRemito): RemitoEnviado {
  return {
    clienteId: editor.clienteId,
    puntoVenta: editor.puntoVenta,
    fecha: editor.fecha,
    fechaVencimientoPago: editor.fechaVencimientoPago,
    condicionPago: editor.condicionPago,
    listaPrecioId: editor.listaPrecioId,
    transporteId: editor.transporteId === "" ? null : editor.transporteId,
    domicilioEntrega: editor.domicilioEntrega,
    observaciones: editor.observaciones,
    valorDeclarado: editor.valorDeclarado.valor,
    items: editor.filas.map(filaRemitoEnviada),
  };
}

/**
 * Estado del editor para un remito guardado. El valor declarado se carga
 * como manual si difiere de la suma de los importes de los ítems; si es
 * igual, sigue a la suma.
 */
export function editorDeRemito(
  remito: Remito,
  items: readonly RemitoItem[],
  productos: readonly ProductoVendible[],
): EditorRemito {
  const ordenados = [...items].sort((a, b) => a.orden - b.orden);
  const filas: FilaItemRemito[] =
    ordenados.length > 0
      ? ordenados.map((item) => ({ ...filaDeItem(item, productos), bultos: String(item.bultos) }))
      : [filaRemitoVacia()];
  const guardado = escalarDecimal(remito.valor_declarado, 2) ?? 0n;
  const sugerido = escalarDecimal(valorDeclaradoSugerido(filas), 2) ?? 0n;
  return {
    clienteId: remito.cliente_id,
    puntoVenta: String(remito.punto_venta),
    fecha: remito.fecha,
    fechaVencimientoPago: remito.fecha_vencimiento_pago,
    condicionPago: remito.condicion_pago,
    listaPrecioId: remito.lista_precio_id,
    transporteId: remito.transporte_id ?? "",
    domicilioEntrega: remito.domicilio_entrega ?? "",
    observaciones: remito.observaciones ?? "",
    valorDeclarado: { valor: desescalar(guardado, 2).toFixed(2), manual: guardado !== sugerido },
    filas,
  };
}

/**
 * Transporte y domicilio de entrega con que arranca un remito: los del
 * cliente («dirección, localidad, provincia», sin lo vacío). Después se
 * pueden cambiar.
 */
export function datosDeEntregaDelCliente(cliente: {
  transporte_id: string | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
}): { transporteId: string; domicilioEntrega: string } {
  const partes = [cliente.direccion, cliente.localidad, cliente.provincia].map(texto).filter(Boolean);
  return { transporteId: cliente.transporte_id ?? "", domicilioEntrega: partes.join(", ") };
}
