/**
 * Cuenta corriente de proveedores (Compras → Cuentas corrientes y la ficha
 * del proveedor): es la de clientes al revés. Las facturas y notas de
 * débito suman lo que le debemos; las notas de crédito y las órdenes de
 * pago lo restan. Saldo positivo: le debemos. Negativo: tenemos a favor.
 * El rango de fechas, la antigüedad y los filtros de la URL son los mismos
 * que en ventas.
 */
import { aCentavos, aPesos, textoPesos } from "@/lib/cobranzas/dinero";
import type { OrdenCuentas } from "@/lib/cobranzas/cuenta-corriente";

export { diasDeAntiguedad, leerFiltrosCuentas, rangoMovimientos } from "@/lib/cobranzas/cuenta-corriente";
export type { OrdenCuentas } from "@/lib/cobranzas/cuenta-corriente";

/** Fila de v_proveedor_cuenta_resumen. */
export type FilaCuentaProveedor = {
  proveedorId: string;
  nombre: string;
  /** Positivo: le debemos. Negativo: a favor. */
  saldo: number;
  deudaPendiente: number;
  saldoAFavor: number;
  /** Fecha del débito pendiente más viejo, o null si no le debemos nada. */
  pendienteMasViejo: string | null;
  pendientes: number;
};

/** Cómo se muestra un saldo: le debemos (rojo), a favor (azul) o sin saldo. */
export function estadoSaldoProveedor(saldo: number): { texto: string; tono: "rojo" | "azul" | "neutro" } {
  const centavos = aCentavos(saldo);
  if (centavos > 0) return { texto: "Le debemos", tono: "rojo" };
  if (centavos < 0) return { texto: "A favor", tono: "azul" };
  return { texto: "Sin saldo", tono: "neutro" };
}

/**
 * Por saldo: de mayor a menor (a quienes más les debemos primero). Por
 * antigüedad: la deuda pendiente más vieja primero; los que no tienen
 * pendientes, al final por saldo. Empates por nombre.
 */
export function ordenarCuentasProveedor(
  filas: readonly FilaCuentaProveedor[],
  orden: OrdenCuentas,
): FilaCuentaProveedor[] {
  const porNombre = (x: FilaCuentaProveedor, y: FilaCuentaProveedor) => x.nombre.localeCompare(y.nombre, "es");
  const porSaldo = (x: FilaCuentaProveedor, y: FilaCuentaProveedor) =>
    aCentavos(y.saldo) - aCentavos(x.saldo) || porNombre(x, y);
  if (orden === "saldo") return [...filas].sort(porSaldo);
  return [...filas].sort((x, y) => {
    if (x.pendienteMasViejo && y.pendienteMasViejo) {
      return x.pendienteMasViejo.localeCompare(y.pendienteMasViejo) || porSaldo(x, y);
    }
    if (x.pendienteMasViejo) return -1;
    if (y.pendienteMasViejo) return 1;
    return porSaldo(x, y);
  });
}

/** Total adeudado (suma de pendientes) y total a favor de las filas. */
export function totalesCuentasProveedor(filas: readonly FilaCuentaProveedor[]): { adeudado: number; aFavor: number } {
  let adeudado = 0;
  let aFavor = 0;
  for (const f of filas) {
    adeudado += aCentavos(f.deudaPendiente);
    aFavor += aCentavos(f.saldoAFavor);
  }
  return { adeudado: aPesos(adeudado), aFavor: aPesos(aFavor) };
}

/** Escapa los comodines de LIKE (% y _) y la barra invertida. */
function escaparLike(texto: string): string {
  return texto.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Valor entre comillas para un filtro `or` de PostgREST (protege comas y paréntesis). */
function entreComillas(texto: string): string {
  return `"${texto.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

/**
 * Filtro `or` de PostgREST para buscar `texto` en el nombre y el CUIT del
 * proveedor (contiene, sin distinguir mayúsculas). null si no hay nada que
 * buscar. El asterisco se descarta porque PostgREST lo toma como comodín.
 */
export function filtroBusquedaProveedores(texto: string | null | undefined): string | null {
  const limpio = (texto ?? "").replace(/\*/g, "").trim();
  if (limpio === "") return null;
  const patron = entreComillas(`%${escaparLike(limpio)}%`);
  return `nombre.ilike.${patron},cuit.ilike.${patron}`;
}

/**
 * Lo que aplica aplicar_saldo_a_favor_compra a un débito: su saldo
 * pendiente, hasta lo que haya a favor. Cero si falta alguno de los dos.
 */
export function importeAAplicar(saldoDebito: number, aFavor: number): number {
  return aPesos(Math.max(0, Math.min(aCentavos(saldoDebito), aCentavos(aFavor))));
}

/** Texto de la confirmación antes de aplicar el saldo a favor a un débito. */
export function resumenAplicacion(numeroTexto: string, saldoDebito: number, aFavor: number): string {
  const importe = importeAAplicar(saldoDebito, aFavor);
  const queda = aPesos(aCentavos(saldoDebito) - aCentavos(importe));
  const despues = queda > 0 ? `Quedan ${textoPesos(queda)} pendientes.` : "Queda cancelado.";
  return `Se van a aplicar ${textoPesos(importe)} del saldo a favor a ${numeroTexto}. ${despues}`;
}
