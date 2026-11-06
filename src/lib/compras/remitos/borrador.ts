/**
 * Remitos de compra: estado del editor, lo que manda la pantalla y lo que
 * se guarda con guardar_remito_compra(p_id, p_remito, p_items).
 *
 * Cada renglón lleva un artículo del proveedor (no hay renglones libres):
 *   - articulo: uno del catálogo (proveedor_articulo_id);
 *   - nuevo: uno que todavía no está en el catálogo (articulo_nuevo, con su
 *     materia prima; la base lo busca o lo crea, como en las facturas).
 * La búsqueda de artículos y lo que toma el renglón al elegir uno son los
 * de las facturas (ver comprobantes/borrador.ts).
 */
import { esObjeto, esUuid, texto } from "@/lib/comprobantes/borrador";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import {
  MAXIMO_NUMERO,
  MAXIMO_PUNTO_VENTA,
  enteroEntre,
  type ArticuloNuevoGuardado,
} from "@/lib/compras/comprobantes/borrador";
import { validarArticulo } from "@/lib/proveedores/validacion";
import { desescalar, escalarDecimal } from "@/lib/remitos/decimal";
import type { RemitoCompra, RemitoCompraItem } from "@/lib/tipos";

/** Decimales de una cantidad (numeric(14,4)). */
const DECIMALES_CANTIDAD = 4;

// ----- Estado del editor ----------------------------------------------------

export type ModoRenglonRemito = "articulo" | "nuevo";

/** Renglón en pantalla. Los números, como texto de los campos. */
export type FilaRemitoCompra = {
  clave: string;
  modo: ModoRenglonRemito;
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
};

export type EditorRemitoCompra = {
  proveedorId: string;
  puntoVenta: string;
  numero: string;
  /** yyyy-mm-dd */
  fecha: string;
  observaciones: string;
  filas: FilaRemitoCompra[];
};

let contador = 0;
const nuevaClave = () => `remito-compra-${++contador}`;

export function filaRemitoCompraVacia(): FilaRemitoCompra {
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
  };
}

/** Un remito nuevo: de hoy, con un renglón vacío. */
export function editorRemitoCompraNuevo(hoy: string): EditorRemitoCompra {
  return { proveedorId: "", puntoVenta: "", numero: "", fecha: hoy, observaciones: "", filas: [filaRemitoCompraVacia()] };
}

/** Estado del editor para un remito guardado (un borrador). */
export function editorDeRemitoCompra(remito: RemitoCompra, items: readonly RemitoCompraItem[]): EditorRemitoCompra {
  const filas = [...items]
    .sort((a, b) => a.orden - b.orden)
    .map(
      (i): FilaRemitoCompra => ({
        ...filaRemitoCompraVacia(),
        articuloId: i.proveedor_articulo_id,
        codigo: i.codigo_proveedor ?? "",
        descripcion: i.descripcion,
        unidad: i.unidad ?? "",
        cantidad: String(i.cantidad),
      }),
    );
  return {
    proveedorId: remito.proveedor_id,
    puntoVenta: String(remito.punto_venta),
    numero: String(remito.numero),
    fecha: remito.fecha,
    observaciones: remito.observaciones ?? "",
    filas: filas.length > 0 ? filas : [filaRemitoCompraVacia()],
  };
}

// ----- Lo que manda la pantalla ---------------------------------------------

export type RenglonRemitoEnviado = Omit<FilaRemitoCompra, "clave" | "busqueda">;
export type RemitoCompraEnviado = Omit<EditorRemitoCompra, "filas"> & { renglones: RenglonRemitoEnviado[] };

export function remitoCompraEnviado(editor: EditorRemitoCompra): RemitoCompraEnviado {
  const { filas, ...cabecera } = editor;
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
    })),
  };
}

// ----- Lo que se guarda (parámetros de guardar_remito_compra) ---------------

/** p_remito: las claves que lee la función. */
export type CabeceraRemitoCompraGuardada = {
  proveedor_id: string;
  punto_venta: number;
  numero: number;
  fecha: string;
  observaciones: string | null;
};

/** Un elemento de p_items: con proveedor_articulo_id o con articulo_nuevo. */
export type ItemRemitoCompraGuardado = {
  proveedor_articulo_id?: string;
  articulo_nuevo?: ArticuloNuevoGuardado;
  codigo_proveedor: string | null;
  descripcion: string;
  unidad: string | null;
  cantidad: number;
};

export type RemitoCompraArmado = { remito: CabeceraRemitoCompraGuardada; items: ItemRemitoCompraGuardado[] };

export type ParametrosGuardarRemitoCompra = {
  p_id: string | null;
  p_remito: CabeceraRemitoCompraGuardada;
  p_items: ItemRemitoCompraGuardado[];
};

function armarRenglon(r: Record<string, unknown>, indice: number): { item: ItemRemitoCompraGuardado } | { errores: string[] } {
  const prefijo = `Renglón ${indice + 1}: `;
  const errores: string[] = [];
  const descripcion = typeof r.descripcion === "string" ? r.descripcion : "";

  let articulo: Pick<ItemRemitoCompraGuardado, "proveedor_articulo_id" | "articulo_nuevo"> = {};
  if (r.modo === "nuevo") {
    if (descripcion.trim() === "") errores.push(`${prefijo}escribí la descripción.`);
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
  } else if (r.modo === "articulo" && esUuid(r.articuloId)) {
    articulo = { proveedor_articulo_id: r.articuloId };
  } else {
    errores.push(`${prefijo}elegí el artículo del proveedor.`);
  }

  const textoCantidad = typeof r.cantidad === "string" ? r.cantidad : typeof r.cantidad === "number" ? String(r.cantidad) : "";
  const cantidad = textoCantidad.trim() === "" ? null : escalarDecimal(textoCantidad, DECIMALES_CANTIDAD, { exacto: true });
  if (cantidad === null && textoCantidad.trim() !== "" && escalarDecimal(textoCantidad, DECIMALES_CANTIDAD) !== null) {
    errores.push(`${prefijo}la cantidad admite hasta 4 decimales.`);
  } else if (cantidad === null || cantidad <= 0n) {
    errores.push(`${prefijo}la cantidad tiene que ser mayor que cero.`);
  }

  if (errores.length > 0) return { errores };
  return {
    item: {
      ...articulo,
      codigo_proveedor: texto(r.codigo),
      descripcion,
      unidad: texto(r.unidad),
      cantidad: desescalar(cantidad!, DECIMALES_CANTIDAD),
    },
  };
}

/**
 * Valida lo enviado por la pantalla y arma los parámetros de
 * guardar_remito_compra. Repite los controles de la base para dar un
 * mensaje claro antes de ir a guardar; la base vuelve a controlar todo.
 */
export function armarRemitoCompra(enviado: unknown): { armado: RemitoCompraArmado } | { errores: string[] } {
  if (!esObjeto(enviado) || !Array.isArray(enviado.renglones)) {
    return { errores: ["Los datos del remito no son válidos."] };
  }
  const errores: string[] = [];

  const proveedorId = esUuid(enviado.proveedorId) ? enviado.proveedorId : null;
  if (!proveedorId) errores.push("Elegí el proveedor.");
  const puntoVenta = enteroEntre(enviado.puntoVenta, MAXIMO_PUNTO_VENTA);
  if (puntoVenta === null) errores.push("El punto de venta va de 1 a 99999.");
  const numero = enteroEntre(enviado.numero, MAXIMO_NUMERO);
  if (numero === null) errores.push("El número del remito va de 1 a 99999999.");
  const fecha = typeof enviado.fecha === "string" && esFechaValida(enviado.fecha) ? enviado.fecha : null;
  if (!fecha) errores.push("La fecha del remito no es válida.");

  if (enviado.renglones.length === 0) errores.push("Agregá al menos un renglón.");
  const items: ItemRemitoCompraGuardado[] = [];
  enviado.renglones.forEach((r: unknown, i: number) => {
    const armado = armarRenglon(esObjeto(r) ? r : {}, i);
    if ("errores" in armado) errores.push(...armado.errores);
    else items.push(armado.item);
  });

  if (errores.length > 0) return { errores };
  return {
    armado: {
      remito: {
        proveedor_id: proveedorId!,
        punto_venta: puntoVenta!,
        numero: numero!,
        fecha: fecha!,
        observaciones: texto(enviado.observaciones),
      },
      items,
    },
  };
}

/** Parámetros exactos de guardar_remito_compra. id null: remito nuevo (borrador). */
export function parametrosGuardarRemitoCompra(id: string | null, armado: RemitoCompraArmado): ParametrosGuardarRemitoCompra {
  return { p_id: id, p_remito: armado.remito, p_items: armado.items };
}
