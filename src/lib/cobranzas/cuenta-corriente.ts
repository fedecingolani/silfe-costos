/**
 * Cuenta corriente del cliente y listado general de saldos: antigüedad de
 * la deuda, rango de fechas de los movimientos, orden, filtros que llegan
 * por la URL y totales. Las fechas son yyyy-mm-dd (como las guarda la
 * base) y se calculan en UTC para no depender de la zona del servidor.
 */
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { aCentavos, aPesos } from "./dinero";

/** Fila de v_cliente_cuenta_resumen. */
export type FilaCuenta = {
  clienteId: string;
  razonSocial: string;
  /** Positivo: debe. Negativo: a favor. */
  saldo: number;
  deudaPendiente: number;
  saldoAFavor: number;
  /** Fecha del débito pendiente más viejo, o null si no debe nada. */
  pendienteMasViejo: string | null;
  pendientes: number;
};

export type OrdenCuentas = "saldo" | "antiguedad";

type Parametros = Record<string, string | string[] | undefined>;

const MS_POR_DIA = 86_400_000;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

function diaUtc(fecha: string): number {
  const [a, m, d] = fecha.split("-").map(Number);
  return Date.UTC(a, m - 1, d) / MS_POR_DIA;
}

/** Días corridos desde `fecha` hasta `hoy`; 0 si es de hoy o futura. */
export function diasDeAntiguedad(fecha: string, hoy: string): number {
  return Math.max(0, diaUtc(hoy) - diaUtc(fecha));
}

/**
 * Rango de fechas de los movimientos. Por defecto, los últimos 12 meses
 * (del mismo día del año anterior hasta hoy). Las fechas inválidas se
 * ignoran y un rango al revés se da vuelta.
 */
export function rangoMovimientos(parametros: Parametros, hoy: string): { desde: string; hasta: string } {
  const [a, m, d] = hoy.split("-").map(Number);
  const haceUnAnio = new Date(Date.UTC(a - 1, m - 1, d)).toISOString().slice(0, 10);
  const pedidoDesde = primero(parametros.desde);
  const pedidoHasta = primero(parametros.hasta);
  const desde = esFechaValida(pedidoDesde) ? pedidoDesde : haceUnAnio;
  const hasta = esFechaValida(pedidoHasta) ? pedidoHasta : hoy;
  return desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };
}

/** Orden (`?orden=antiguedad`, por defecto saldo) y texto de búsqueda (`?q=`). */
export function leerFiltrosCuentas(parametros: Parametros): { orden: OrdenCuentas; texto: string } {
  return {
    orden: primero(parametros.orden) === "antiguedad" ? "antiguedad" : "saldo",
    texto: primero(parametros.q),
  };
}

/**
 * Por saldo: de mayor a menor (los deudores primero, los que tienen a favor
 * al final). Por antigüedad: la deuda pendiente más vieja primero; los que
 * no deben nada, al final por saldo. Empates por razón social.
 */
export function ordenarCuentas(filas: readonly FilaCuenta[], orden: OrdenCuentas): FilaCuenta[] {
  const porNombre = (x: FilaCuenta, y: FilaCuenta) => x.razonSocial.localeCompare(y.razonSocial, "es");
  const porSaldo = (x: FilaCuenta, y: FilaCuenta) => aCentavos(y.saldo) - aCentavos(x.saldo) || porNombre(x, y);
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
export function totalesCuentas(filas: readonly FilaCuenta[]): { adeudado: number; aFavor: number } {
  let adeudado = 0;
  let aFavor = 0;
  for (const f of filas) {
    adeudado += aCentavos(f.deudaPendiente);
    aFavor += aCentavos(f.saldoAFavor);
  }
  return { adeudado: aPesos(adeudado), aFavor: aPesos(aFavor) };
}

/** Cómo se muestra un saldo: deudor (rojo), a favor (azul) o sin saldo. */
export function estadoSaldo(saldo: number): { texto: string; tono: "rojo" | "azul" | "neutro" } {
  const centavos = aCentavos(saldo);
  if (centavos > 0) return { texto: "Deudor", tono: "rojo" };
  if (centavos < 0) return { texto: "A favor", tono: "azul" };
  return { texto: "Sin saldo", tono: "neutro" };
}
