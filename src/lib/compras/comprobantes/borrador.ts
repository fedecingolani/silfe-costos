/**
 * Comprobantes de compra: estado del editor, lo que manda la pantalla y lo
 * que se guarda con guardar_comprobante_compra(p_id, p_comprobante,
 * p_items, p_percepciones). Los importes y totales no se mandan: los
 * calcula la base (ver totales.ts para la vista previa).
 *
 * Cada renglón es uno de tres:
 *   - articulo: un artículo del catálogo del proveedor (proveedor_articulo_id);
 *   - nuevo: un artículo que todavía no está en el catálogo (articulo_nuevo,
 *     la base lo busca o lo crea con su materia prima);
 *   - libre: sin artículo ni materia prima (flete, servicio).
 */
import { esObjeto, esUuid, texto } from "@/lib/comprobantes/borrador";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { validarArticulo } from "@/lib/proveedores/validacion";
import { desescalar, escalarDecimal } from "@/lib/remitos/decimal";
import {
  ALICUOTAS_IVA,
  LETRAS_COMPRA,
  NO_GRAVADO,
  TIPOS_COMPROBANTE_COMPRA,
  TIPOS_PERCEPCION_COMPRA,
  type AlicuotaIva,
  type ComprobanteCompra,
  type ComprobanteCompraItem,
  type ComprobanteCompraPercepcion,
  type LetraCompra,
  type ProveedorArticulo,
  type TipoComprobanteCompra,
  type TipoPercepcionCompra,
} from "@/lib/tipos";
import { discriminaIva } from "./letra";
import type { RenglonCalculable } from "./totales";

// ----- Estado del editor ----------------------------------------------------

export type ModoRenglon = "articulo" | "nuevo" | "libre";

/** Renglón en pantalla. Los números, como texto de los campos. */
export type FilaCompra = {
  clave: string;
  modo: ModoRenglon;
  /** modo articulo: el artículo elegido. */
  articuloId: string | null;
  /** Texto del buscador de artículos. */
  busqueda: string;
  /** Código y descripción tal como los escribió el proveedor. */
  codigo: string;
  descripcion: string;
  unidad: string;
  /** modo nuevo: materia prima y factor de conversión del artículo que se crea. */
  materiaPrimaId: string;
  factor: string;
  cantidad: string;
  precioUnitario: string;
  descuentoPct: string;
  /** "21", "10.5"… o NO_GRAVADO. */
  alicuotaIva: string;
  exento: boolean;
};

export type FilaPercepcion = {
  clave: string;
  tipo: TipoPercepcionCompra | "";
  jurisdiccion: string;
  descripcion: string;
  importe: string;
};

export type EditorComprobanteCompra = {
  proveedorId: string;
  tipo: TipoComprobanteCompra;
  letra: LetraCompra;
  puntoVenta: string;
  numero: string;
  /** yyyy-mm-dd */
  fecha: string;
  /** yyyy-mm-dd o vacío. */
  fechaVencimiento: string;
  observaciones: string;
  /** Nota: id de la factura que corrige, o vacío (nota suelta). Una factura lo ignora. */
  comprobanteAsociadoId: string;
  filas: FilaCompra[];
  percepciones: FilaPercepcion[];
};

let contador = 0;
const nuevaClave = () => `compra-${++contador}`;

export function filaCompraVacia(): FilaCompra {
  return {
    clave: nuevaClave(),
    modo: "articulo",
    articuloId: null,
    busqueda: "",
    codigo: "",
    descripcion: "",
    unidad: "",
    materiaPrimaId: "",
    factor: "1",
    cantidad: "1",
    precioUnitario: "",
    descuentoPct: "",
    alicuotaIva: "21",
    exento: false,
  };
}

export function filaPercepcionVacia(): FilaPercepcion {
  return { clave: nuevaClave(), tipo: "iva", jurisdiccion: "", descripcion: "", importe: "" };
}

/** Un comprobante nuevo: factura A de hoy, con un renglón vacío. */
export function editorComprobanteCompraNuevo(hoy: string): EditorComprobanteCompra {
  return {
    proveedorId: "",
    tipo: "factura",
    letra: "A",
    puntoVenta: "",
    numero: "",
    fecha: hoy,
    fechaVencimiento: "",
    observaciones: "",
    comprobanteAsociadoId: "",
    filas: [filaCompraVacia()],
    percepciones: [],
  };
}

/** Estado del editor para un comprobante guardado (un borrador). */
export function editorDeComprobanteCompra(
  comprobante: ComprobanteCompra,
  items: readonly ComprobanteCompraItem[],
  percepciones: readonly ComprobanteCompraPercepcion[],
): EditorComprobanteCompra {
  const filas = [...items]
    .sort((a, b) => a.orden - b.orden)
    .map(
      (i): FilaCompra => ({
        ...filaCompraVacia(),
        modo: i.proveedor_articulo_id ? "articulo" : "libre",
        articuloId: i.proveedor_articulo_id,
        codigo: i.codigo_proveedor ?? "",
        descripcion: i.descripcion,
        unidad: i.unidad ?? "",
        cantidad: String(i.cantidad),
        precioUnitario: String(i.precio_unitario),
        descuentoPct: Number(i.descuento_pct) === 0 ? "" : String(i.descuento_pct),
        alicuotaIva: i.alicuota_iva === null ? NO_GRAVADO : String(i.alicuota_iva),
        exento: i.exento,
      }),
    );
  return {
    proveedorId: comprobante.proveedor_id,
    tipo: comprobante.tipo,
    letra: comprobante.letra,
    puntoVenta: String(comprobante.punto_venta),
    numero: String(comprobante.numero),
    fecha: comprobante.fecha,
    fechaVencimiento: comprobante.fecha_vencimiento ?? "",
    observaciones: comprobante.observaciones ?? "",
    comprobanteAsociadoId: comprobante.comprobante_asociado_id ?? "",
    filas: filas.length > 0 ? filas : [filaCompraVacia()],
    percepciones: percepciones.map((p) => ({
      clave: nuevaClave(),
      tipo: p.tipo,
      jurisdiccion: p.jurisdiccion ?? "",
      descripcion: p.descripcion ?? "",
      importe: String(p.importe),
    })),
  };
}

// ----- Artículos del proveedor ----------------------------------------------

/** Artículos activos cuyo código o descripción contiene el texto (sin mayúsculas). */
export function buscarArticulos(articulos: readonly ProveedorArticulo[], busqueda: string, limite = 20): ProveedorArticulo[] {
  const t = busqueda.trim().toLowerCase();
  if (t === "") return [];
  return articulos
    .filter(
      (a) => a.activo && ((a.codigo ?? "").toLowerCase().includes(t) || a.descripcion.toLowerCase().includes(t)),
    )
    .slice(0, limite);
}

/** Al elegir un artículo, el renglón toma su código, descripción y unidad (después se pueden cambiar). */
export function cambiosAlElegirArticulo(
  articulo: ProveedorArticulo,
): Pick<FilaCompra, "articuloId" | "busqueda" | "codigo" | "descripcion" | "unidad"> {
  return {
    articuloId: articulo.id,
    busqueda: "",
    codigo: articulo.codigo ?? "",
    descripcion: articulo.descripcion,
    unidad: articulo.unidad ?? "",
  };
}

/** Lo que necesita totales.ts de un renglón. */
export function renglonCalculable(fila: FilaCompra): RenglonCalculable {
  return {
    cantidad: fila.cantidad,
    precioUnitario: fila.precioUnitario,
    descuentoPct: fila.descuentoPct,
    alicuotaIva: fila.alicuotaIva === NO_GRAVADO || fila.alicuotaIva === "" ? null : Number(fila.alicuotaIva),
    exento: fila.exento,
  };
}

// ----- Lo que manda la pantalla ---------------------------------------------

export type RenglonEnviado = Omit<FilaCompra, "clave" | "busqueda">;
export type PercepcionEnviada = Omit<FilaPercepcion, "clave">;
export type ComprobanteCompraEnviado = Omit<EditorComprobanteCompra, "filas" | "percepciones"> & {
  renglones: RenglonEnviado[];
  percepciones: PercepcionEnviada[];
};

/**
 * Lo que manda el editor a la acción de guardar. En B y C, y en los
 * exentos, el renglón va sin alícuota; el editor conserva la elegida por si
 * se vuelve a A o se quita el exento.
 */
export function comprobanteEnviado(editor: EditorComprobanteCompra): ComprobanteCompraEnviado {
  const { filas, percepciones, ...cabecera } = editor;
  const conIva = discriminaIva(editor.letra);
  return {
    ...cabecera,
    renglones: filas.map((f) => ({
      modo: f.modo,
      articuloId: f.articuloId,
      codigo: f.codigo,
      descripcion: f.descripcion,
      unidad: f.unidad,
      materiaPrimaId: f.materiaPrimaId,
      factor: f.factor,
      cantidad: f.cantidad,
      precioUnitario: f.precioUnitario,
      descuentoPct: f.descuentoPct,
      alicuotaIva: conIva && !f.exento ? f.alicuotaIva : NO_GRAVADO,
      exento: f.exento,
    })),
    percepciones: percepciones.map((p) => ({
      tipo: p.tipo,
      jurisdiccion: p.jurisdiccion,
      descripcion: p.descripcion,
      importe: p.importe,
    })),
  };
}

// ----- Lo que se guarda (parámetros de guardar_comprobante_compra) ----------

/** p_comprobante: las claves que lee la función. */
export type CabeceraCompraGuardada = {
  proveedor_id: string;
  tipo: TipoComprobanteCompra;
  letra: LetraCompra;
  punto_venta: number;
  numero: number;
  fecha: string;
  fecha_vencimiento: string | null;
  observaciones: string | null;
  /** Sólo en una nota: la factura que corrige. */
  comprobante_asociado_id: string | null;
};

export type ArticuloNuevoGuardado = {
  codigo: string | null;
  descripcion: string;
  unidad: string | null;
  factor_conversion: number;
  materia_prima_id: string;
};

/** Un elemento de p_items: con proveedor_articulo_id, con articulo_nuevo o con ninguno (libre). */
export type ItemCompraGuardado = {
  proveedor_articulo_id?: string;
  articulo_nuevo?: ArticuloNuevoGuardado;
  codigo_proveedor: string | null;
  descripcion: string;
  unidad: string | null;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  alicuota_iva: AlicuotaIva | null;
  exento: boolean;
};

export type PercepcionGuardada = {
  tipo: TipoPercepcionCompra;
  jurisdiccion: string | null;
  descripcion: string | null;
  importe: number;
};

export type ComprobanteCompraArmado = {
  comprobante: CabeceraCompraGuardada;
  items: ItemCompraGuardado[];
  percepciones: PercepcionGuardada[];
};

export type ParametrosGuardarComprobanteCompra = {
  p_id: string | null;
  p_comprobante: CabeceraCompraGuardada;
  p_items: ItemCompraGuardado[];
  p_percepciones: PercepcionGuardada[];
};

const MAXIMO_PUNTO_VENTA = 99999;
const MAXIMO_NUMERO = 99999999;

/** Entero de 1 a `maximo`, o null. */
function enteroEntre(valor: unknown, maximo: number): number | null {
  const t = typeof valor === "string" ? valor.trim() : typeof valor === "number" ? String(valor) : "";
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= maximo ? n : null;
}

/** Decimal escalado de un campo; vacío es `vacio` (null: obligatorio). */
function decimal(valor: unknown, decimales: number, vacio: bigint | null = null): bigint | null {
  if (typeof valor === "number") return escalarDecimal(valor, decimales);
  const t = typeof valor === "string" ? valor.trim() : "";
  return t === "" ? vacio : escalarDecimal(t, decimales);
}

function leerAlicuota(valor: unknown): AlicuotaIva | null | undefined {
  if (valor === NO_GRAVADO || valor === "" || valor === null || valor === undefined) return null;
  const n = Number(valor);
  return (ALICUOTAS_IVA as readonly number[]).includes(n) ? (n as AlicuotaIva) : undefined;
}

function armarRenglon(
  r: Record<string, unknown>,
  indice: number,
  letra: LetraCompra | null,
): { item: ItemCompraGuardado } | { errores: string[] } {
  const prefijo = `Renglón ${indice + 1}: `;
  const errores: string[] = [];
  const modo = r.modo === "articulo" || r.modo === "nuevo" ? r.modo : "libre";
  const descripcion = typeof r.descripcion === "string" ? r.descripcion : "";

  let articulo: Pick<ItemCompraGuardado, "proveedor_articulo_id" | "articulo_nuevo"> = {};
  if (modo === "articulo") {
    if (esUuid(r.articuloId)) articulo = { proveedor_articulo_id: r.articuloId };
    else errores.push(`${prefijo}elegí el artículo del proveedor.`);
  } else {
    if (descripcion.trim() === "") errores.push(`${prefijo}escribí la descripción.`);
  }

  const cantidad = decimal(r.cantidad, 4);
  if (cantidad === null || cantidad <= 0n) errores.push(`${prefijo}la cantidad tiene que ser mayor que cero.`);
  const precio = decimal(r.precioUnitario, 4);
  if (precio === null || precio < 0n) errores.push(`${prefijo}el precio tiene que ser un número, 0 o más.`);
  const descuento = decimal(r.descuentoPct, 2, 0n);
  if (descuento === null || descuento < 0n || descuento > 10000n) errores.push(`${prefijo}el descuento va de 0 a 100.`);

  if (modo === "nuevo") {
    if (!esUuid(r.materiaPrimaId)) errores.push(`${prefijo}elegí la materia prima del artículo nuevo.`);
    const validado = validarArticulo({
      codigo: typeof r.codigo === "string" ? r.codigo : null,
      descripcion,
      unidad: typeof r.unidad === "string" ? r.unidad : null,
      factor: typeof r.factor === "string" ? r.factor : r.factor == null ? null : String(r.factor),
      materia_prima_id: null,
    });
    if ("error" in validado) {
      // La falta de descripción ya se informó arriba.
      if (descripcion.trim() !== "") errores.push(`${prefijo}${validado.error.charAt(0).toLowerCase()}${validado.error.slice(1)}`);
    } else if (esUuid(r.materiaPrimaId)) {
      articulo = {
        articulo_nuevo: {
          codigo: validado.datos.codigo,
          descripcion: validado.datos.descripcion,
          unidad: validado.datos.unidad,
          factor_conversion: validado.datos.factor_conversion,
          materia_prima_id: r.materiaPrimaId,
        },
      };
    }
  }

  const exento = r.exento === true;
  const alicuota = exento ? null : leerAlicuota(r.alicuotaIva);
  if (alicuota === undefined) errores.push(`${prefijo}la alícuota de IVA no es válida.`);
  else if (alicuota !== null && letra !== null && !discriminaIva(letra)) {
    errores.push(`${prefijo}los comprobantes B y C no discriminan IVA: el renglón no lleva alícuota.`);
  }

  if (errores.length > 0) return { errores };
  return {
    item: {
      ...articulo,
      codigo_proveedor: texto(r.codigo),
      descripcion,
      unidad: texto(r.unidad),
      cantidad: desescalar(cantidad!, 4),
      precio_unitario: desescalar(precio!, 4),
      descuento_pct: desescalar(descuento!, 2),
      alicuota_iva: alicuota!,
      exento,
    },
  };
}

function armarPercepcion(p: Record<string, unknown>, indice: number): { percepcion: PercepcionGuardada } | { errores: string[] } {
  const prefijo = `Percepción ${indice + 1}: `;
  const errores: string[] = [];
  const tipo = (TIPOS_PERCEPCION_COMPRA as readonly unknown[]).includes(p.tipo) ? (p.tipo as TipoPercepcionCompra) : null;
  if (!tipo) errores.push(`${prefijo}elegí el tipo.`);
  const jurisdiccion = texto(p.jurisdiccion);
  if (tipo === "iibb" && !jurisdiccion) errores.push(`${prefijo}indicá la jurisdicción de ingresos brutos.`);
  const importe = decimal(p.importe, 2);
  if (importe === null || importe <= 0n) errores.push(`${prefijo}el importe tiene que ser mayor que cero.`);
  if (errores.length > 0) return { errores };
  return { percepcion: { tipo: tipo!, jurisdiccion, descripcion: texto(p.descripcion), importe: desescalar(importe!, 2) } };
}

/**
 * Valida lo enviado por la pantalla y arma los parámetros de
 * guardar_comprobante_compra. Repite los controles de la base para dar un
 * mensaje claro antes de ir a guardar; la base vuelve a controlar todo.
 */
export function armarComprobanteCompra(
  enviado: unknown,
): { armado: ComprobanteCompraArmado } | { errores: string[] } {
  if (!esObjeto(enviado) || !Array.isArray(enviado.renglones) || !Array.isArray(enviado.percepciones)) {
    return { errores: ["Los datos del comprobante no son válidos."] };
  }
  const errores: string[] = [];

  const proveedorId = esUuid(enviado.proveedorId) ? enviado.proveedorId : null;
  if (!proveedorId) errores.push("Elegí el proveedor.");
  const tipo = (TIPOS_COMPROBANTE_COMPRA as readonly unknown[]).includes(enviado.tipo)
    ? (enviado.tipo as TipoComprobanteCompra)
    : null;
  if (!tipo) errores.push("Elegí el tipo de comprobante.");
  const letra = (LETRAS_COMPRA as readonly unknown[]).includes(enviado.letra) ? (enviado.letra as LetraCompra) : null;
  if (!letra) errores.push("Elegí la letra del comprobante.");
  const puntoVenta = enteroEntre(enviado.puntoVenta, MAXIMO_PUNTO_VENTA);
  if (puntoVenta === null) errores.push("El punto de venta va de 1 a 99999.");
  const numero = enteroEntre(enviado.numero, MAXIMO_NUMERO);
  if (numero === null) errores.push("El número del comprobante va de 1 a 99999999.");
  const fecha = typeof enviado.fecha === "string" && esFechaValida(enviado.fecha) ? enviado.fecha : null;
  if (!fecha) errores.push("La fecha del comprobante no es válida.");
  const vencimientoTexto = typeof enviado.fechaVencimiento === "string" ? enviado.fechaVencimiento.trim() : "";
  const vencimiento = vencimientoTexto === "" ? null : vencimientoTexto;
  if (vencimiento !== null && !esFechaValida(vencimiento)) errores.push("El vencimiento no es una fecha válida.");
  else if (vencimiento !== null && fecha && vencimiento < fecha) {
    errores.push("El vencimiento no puede ser anterior a la fecha del comprobante.");
  }

  // Una factura no lleva factura asociada: el editor la conserva por si se vuelve a nota.
  const asociadoTexto = typeof enviado.comprobanteAsociadoId === "string" ? enviado.comprobanteAsociadoId.trim() : "";
  const asociado = tipo === "factura" || asociadoTexto === "" ? null : asociadoTexto;
  if (asociado !== null && !esUuid(asociado)) errores.push("La factura asociada no es válida.");

  if (enviado.renglones.length === 0) errores.push("Agregá al menos un renglón.");
  const items: ItemCompraGuardado[] = [];
  enviado.renglones.forEach((r: unknown, i: number) => {
    const armado = armarRenglon(esObjeto(r) ? r : {}, i, letra);
    if ("errores" in armado) errores.push(...armado.errores);
    else items.push(armado.item);
  });

  const percepciones: PercepcionGuardada[] = [];
  enviado.percepciones.forEach((p: unknown, i: number) => {
    const armada = armarPercepcion(esObjeto(p) ? p : {}, i);
    if ("errores" in armada) errores.push(...armada.errores);
    else percepciones.push(armada.percepcion);
  });

  if (errores.length > 0) return { errores };
  return {
    armado: {
      comprobante: {
        proveedor_id: proveedorId!,
        tipo: tipo!,
        letra: letra!,
        punto_venta: puntoVenta!,
        numero: numero!,
        fecha: fecha!,
        fecha_vencimiento: vencimiento,
        observaciones: texto(enviado.observaciones),
        comprobante_asociado_id: asociado,
      },
      items,
      percepciones,
    },
  };
}

/** Parámetros exactos de guardar_comprobante_compra. id null: comprobante nuevo (borrador). */
export function parametrosGuardarComprobanteCompra(
  id: string | null,
  armado: ComprobanteCompraArmado,
): ParametrosGuardarComprobanteCompra {
  return { p_id: id, p_comprobante: armado.comprobante, p_items: armado.items, p_percepciones: armado.percepciones };
}
