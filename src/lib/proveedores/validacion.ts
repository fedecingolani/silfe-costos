// Validación pura de los datos fiscales del proveedor y de los artículos de
// su catálogo. Repite los checks de `proveedor` y `proveedor_articulo` para
// devolver un mensaje claro antes de ir a la base.

import { CONDICIONES_IVA, type CondicionIva } from "@/lib/tipos";

/** Datos fiscales editables del proveedor. null = vacío. */
export type DatosFiscalesProveedor = {
  condicion_iva: CondicionIva | null;
  domicilio: string | null;
  cbu: string | null;
  alias: string | null;
};

/** Lo que llega del formulario del artículo, todo como texto. */
export type EntradaArticulo = {
  codigo: string | null;
  descripcion: string | null;
  unidad: string | null;
  factor: string | null;
  materia_prima_id: string | null;
};

/** Columnas editables de `proveedor_articulo`. */
export type DatosArticulo = {
  codigo: string | null;
  descripcion: string;
  unidad: string | null;
  factor_conversion: number;
  materia_prima_id: string | null;
};

type Resultado<T> = { datos: T } | { error: string };

const CBU = /^[0-9]{22}$/;
const ALIAS = /^[A-Za-z0-9.-]{6,20}$/;

function limpiar(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  return texto === "" ? null : texto;
}

/** El CBU sin espacios; null si queda vacío. No valida el largo. */
export function normalizarCbu(valor: string | null | undefined): string | null {
  return limpiar((valor ?? "").replace(/\s+/g, ""));
}

export function esAliasValido(valor: string): boolean {
  return ALIAS.test(valor);
}

function esCondicionIva(valor: string): valor is CondicionIva {
  return (CONDICIONES_IVA as readonly string[]).includes(valor);
}

export function validarDatosFiscales(entrada: {
  condicion_iva: string | null;
  domicilio: string | null;
  cbu: string | null;
  alias: string | null;
}): Resultado<DatosFiscalesProveedor> {
  const condicion = limpiar(entrada.condicion_iva);
  if (condicion !== null && !esCondicionIva(condicion)) {
    return { error: "La condición frente al IVA no es válida." };
  }
  const cbu = normalizarCbu(entrada.cbu);
  if (cbu !== null && !CBU.test(cbu)) {
    return { error: "El CBU tiene que tener 22 dígitos." };
  }
  const alias = limpiar(entrada.alias);
  if (alias !== null && !esAliasValido(alias)) {
    return { error: "El alias tiene que tener de 6 a 20 caracteres: letras, números, puntos o guiones." };
  }
  return { datos: { condicion_iva: condicion, domicilio: limpiar(entrada.domicilio), cbu, alias } };
}

/**
 * Factor de conversión del artículo: acepta coma o punto decimal y vacío es 1
 * (1 a 1). Devuelve null si no es un número mayor que cero.
 */
const FACTOR_MINIMO = 1e-8;
const FACTOR_TOPE = 1e12;

export function parsearFactor(valor: string | null | undefined): number | null {
  const texto = (valor ?? "").trim().replace(",", ".");
  if (texto === "") return 1;
  const n = Number(texto);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function validarArticulo(entrada: EntradaArticulo): Resultado<DatosArticulo> {
  const descripcion = limpiar(entrada.descripcion);
  if (descripcion === null) return { error: "La descripción del artículo es obligatoria." };
  const factor = parsearFactor(entrada.factor);
  if (factor === null) return { error: "El factor de conversión tiene que ser un número mayor que cero." };
  // Rango que guarda numeric(20,8): fuera de él la base lo redondea a 0 o desborda.
  if (factor < FACTOR_MINIMO || factor >= FACTOR_TOPE) {
    return { error: "El factor de conversión tiene que estar entre 0,00000001 y 999.999.999.999." };
  }
  return {
    datos: {
      codigo: limpiar(entrada.codigo),
      descripcion,
      unidad: limpiar(entrada.unidad),
      factor_conversion: factor,
      materia_prima_id: limpiar(entrada.materia_prima_id),
    },
  };
}
