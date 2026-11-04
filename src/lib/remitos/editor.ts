/**
 * Remitos: reglas de la pantalla. Bultos por ítem y total, valor declarado
 * (sigue a la suma de los importes hasta que el usuario lo cambia),
 * validación antes de guardar o emitir, y qué se puede hacer en cada estado.
 */
import { aDecimal, esUuid, itemParaCalcular, type FilaItemEnviada } from "@/lib/comprobantes/borrador";
import { calcularItem } from "@/lib/comprobantes/calculo";
import type { EstadoRemito } from "@/lib/tipos";
import { desescalar, escalarDecimal } from "./decimal";

/** Un renglón tal como está en la pantalla: el de la factura más los bultos (texto). */
export type FilaItemRemitoEnviada = FilaItemEnviada & { bultos: string };

// ----- Bultos ---------------------------------------------------------------

/** Bultos de un renglón: entero 0 o más; vacío es 0. null si no es válido. */
export function leerBultos(valor: unknown): number | null {
  if (typeof valor === "number") return Number.isInteger(valor) && valor >= 0 ? valor : null;
  const t = typeof valor === "string" ? valor.trim() : "";
  if (t === "") return 0;
  return /^\d+$/.test(t) ? Number(t) : null;
}

/** Bultos total: la suma de los bultos de los ítems. Los inválidos o a medio cargar no suman. */
export function bultosTotal(items: readonly { bultos: string | number }[]): number {
  return items.reduce((total, item) => total + (leerBultos(item.bultos) ?? 0), 0);
}

// ----- Valor declarado ------------------------------------------------------

/**
 * Valor declarado sugerido: la suma de los importes de los ítems (sin IVA,
 * con descuento), calculados como en la factura. Los renglones a medio
 * cargar no suman. Se suma en centavos para no arrastrar coma flotante.
 */
export function valorDeclaradoSugerido(items: readonly FilaItemEnviada[]): number {
  let centavos = 0n;
  for (const fila of items) {
    const item = itemParaCalcular(fila);
    if (item) centavos += escalarDecimal(calcularItem(item).importe, 2) ?? 0n;
  }
  return desescalar(centavos, 2);
}

/**
 * Valor declarado en el editor. manual: el usuario lo cambió y queda fijo;
 * si no, sigue a la sugerencia cuando cambian los ítems.
 */
export type ValorDeclarado = { valor: string; manual: boolean };

function sugerencia(items: readonly FilaItemEnviada[]): ValorDeclarado {
  return { valor: valorDeclaradoSugerido(items).toFixed(2), manual: false };
}

/** Al empezar un remito, el valor declarado sigue a la sugerencia. */
export function valorDeclaradoInicial(items: readonly FilaItemEnviada[]): ValorDeclarado {
  return sugerencia(items);
}

/** Después de cambiar los ítems: si no se tocó, la sugerencia nueva; si se cambió a mano, el mismo. */
export function valorDeclaradoAlCambiarItems(actual: ValorDeclarado, items: readonly FilaItemEnviada[]): ValorDeclarado {
  return actual.manual ? actual : sugerencia(items);
}

/** El usuario escribió el valor: queda fijo. */
export function valorDeclaradoEditado(valor: string): ValorDeclarado {
  return { valor, manual: true };
}

/** Volver a la sugerencia: toma la suma y vuelve a seguir a los ítems. */
export function volverAlValorSugerido(items: readonly FilaItemEnviada[]): ValorDeclarado {
  return sugerencia(items);
}

/**
 * Valor declarado a guardar, redondeado a centavos: vacío toma la
 * sugerencia. null si es negativo o no es un número.
 */
export function leerValorDeclarado(valor: string, sugerido: number): number | null {
  if (valor.trim() === "") return sugerido;
  const centavos = escalarDecimal(valor, 2);
  return centavos === null || centavos < 0n ? null : desescalar(centavos, 2);
}

// ----- Validación -----------------------------------------------------------

export const MENSAJE_VALOR_DECLARADO_INVALIDO = "El valor declarado no puede ser negativo ni estar mal escrito.";

export function mensajeBultosInvalidos(indice: number): string {
  return `Ítem ${indice + 1}: los bultos tienen que ser un número entero, 0 o más.`;
}

/** Número de punto de venta (entero positivo) o null. */
export function leerPuntoVenta(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : aDecimal(typeof valor === "string" ? valor : null);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Errores de la pantalla antes de guardar o emitir: cliente, punto de venta,
 * al menos un ítem, bultos enteros 0 o más y valor declarado 0 o más. El
 * resto de los ítems (cantidad, precio, alícuota) lo valida armarRemito.
 */
export function erroresRemito(datos: {
  clienteId: string;
  puntoVenta: string | number;
  valorDeclarado: string;
  items: readonly { bultos: string | number }[];
}): string[] {
  const errores: string[] = [];
  if (!esUuid(datos.clienteId)) errores.push("Elegí el cliente.");
  if (leerPuntoVenta(datos.puntoVenta) === null) errores.push("Elegí el punto de venta.");
  if (datos.items.length === 0) errores.push("Agregá al menos un ítem.");
  datos.items.forEach((item, i) => {
    if (leerBultos(item.bultos) === null) errores.push(mensajeBultosInvalidos(i));
  });
  if (leerValorDeclarado(datos.valorDeclarado, 0) === null) errores.push(MENSAJE_VALOR_DECLARADO_INVALIDO);
  return errores;
}

// ----- Qué se puede hacer en cada estado ------------------------------------

/**
 * Según el estado derivado (v_remito_estado.estado):
 *
 * | Estado    | Se puede                                         |
 * | --------- | ------------------------------------------------ |
 * | borrador  | editar, borrar, emitir                           |
 * | emitido   | editar, imprimir, facturar, anular               |
 * | parcial   | imprimir, facturar lo pendiente                  |
 * | facturado | imprimir                                         |
 * | anulado   | ver e imprimir                                   |
 */
export function puedeEditar(estado: EstadoRemito): boolean {
  return estado === "borrador" || estado === "emitido";
}

export function puedeBorrar(estado: EstadoRemito): boolean {
  return estado === "borrador";
}

export function puedeEmitir(estado: EstadoRemito): boolean {
  return estado === "borrador";
}

/** Sólo un emitido sin nada facturado (con algo facturado el estado ya es parcial o facturado). */
export function puedeAnular(estado: EstadoRemito): boolean {
  return estado === "emitido";
}

export function puedeFacturar(estado: EstadoRemito): boolean {
  return estado === "emitido" || estado === "parcial";
}

/** Un borrador no tiene número: no se imprime. */
export function puedeImprimir(estado: EstadoRemito): boolean {
  return estado !== "borrador";
}

export type PermisosRemito = {
  puedeEditar: boolean;
  puedeBorrar: boolean;
  puedeEmitir: boolean;
  puedeAnular: boolean;
  puedeFacturar: boolean;
  puedeImprimir: boolean;
};

export function permisosRemito(estado: EstadoRemito): PermisosRemito {
  return {
    puedeEditar: puedeEditar(estado),
    puedeBorrar: puedeBorrar(estado),
    puedeEmitir: puedeEmitir(estado),
    puedeAnular: puedeAnular(estado),
    puedeFacturar: puedeFacturar(estado),
    puedeImprimir: puedeImprimir(estado),
  };
}
