/**
 * Cartera de cheques: filtros que llegan por la URL, totales por estado,
 * acciones de cada estado (las transiciones de TRANSICIONES_CHEQUE, que son
 * las de la base) y la validación de un cambio de estado. El rechazo crea la
 * nota de débito en la base (rechazar_cheque).
 */
import { NOMBRES_ESTADO_CHEQUE, type EstadoCheque, type EstadoComprobante } from "@/lib/tipos";
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { TRANSICIONES_CHEQUE, puedePasar } from "./cheques";
import { aCentavos, aPesos } from "./dinero";

/** Estados que se ven en la cartera (anulado: su recibo se anuló, ya no está). */
export const ESTADOS_CARTERA = ["en_cartera", "depositado", "entregado", "rechazado"] as const;

export type EstadoCartera = (typeof ESTADOS_CARTERA)[number];

export type FiltrosCartera = {
  /** Por defecto, en_cartera. */
  estado: EstadoCartera | "todos";
  /** Fecha de pago desde / hasta: yyyy-mm-dd o vacío. */
  desde: string;
  hasta: string;
  /** Texto para buscar el cliente (razón social, CUIT o código). */
  cliente: string;
};

type Parametros = Record<string, string | string[] | undefined>;

function primero(valor: string | string[] | undefined): string {
  return (Array.isArray(valor) ? valor[0] : valor)?.trim() ?? "";
}

export function leerFiltrosCartera(parametros: Parametros): FiltrosCartera {
  const estado = primero(parametros.estado);
  const desde = primero(parametros.desde);
  const hasta = primero(parametros.hasta);
  return {
    estado:
      estado === "todos" || (ESTADOS_CARTERA as readonly string[]).includes(estado)
        ? (estado as EstadoCartera | "todos")
        : "en_cartera",
    desde: esFechaValida(desde) ? desde : "",
    hasta: esFechaValida(hasta) ? hasta : "",
    cliente: primero(parametros.cliente),
  };
}

export function filtrarPorEstado<T extends { estado: EstadoCheque }>(filas: readonly T[], estado: FiltrosCartera["estado"]): T[] {
  return estado === "todos" ? [...filas] : filas.filter((f) => f.estado === estado);
}

export type TotalEstado = { cantidad: number; importe: number };

/** Cantidad e importe por estado de la cartera, exactos a centavos. */
export function totalesPorEstado(
  filas: readonly { estado: EstadoCheque; importe: number }[],
): Record<EstadoCartera, TotalEstado> {
  const centavos = Object.fromEntries(ESTADOS_CARTERA.map((e) => [e, { cantidad: 0, centavos: 0 }])) as Record<
    EstadoCartera,
    { cantidad: number; centavos: number }
  >;
  for (const fila of filas) {
    const total = centavos[fila.estado as EstadoCartera];
    if (!total) continue;
    total.cantidad += 1;
    total.centavos += aCentavos(fila.importe);
  }
  return Object.fromEntries(
    ESTADOS_CARTERA.map((e) => [e, { cantidad: centavos[e].cantidad, importe: aPesos(centavos[e].centavos) }]),
  ) as Record<EstadoCartera, TotalEstado>;
}

// ----- Acciones -----------------------------------------------------------------

export type AccionCheque = "depositar" | "entregar" | "rechazar";

export const DESTINO_ACCION: Record<AccionCheque, EstadoCheque> = {
  depositar: "depositado",
  entregar: "entregado",
  rechazar: "rechazado",
};

export const NOMBRES_ACCION_CHEQUE: Record<AccionCheque, string> = {
  depositar: "Depositar",
  entregar: "Entregar",
  rechazar: "Rechazar",
};

/** Acciones que admite un cheque en ese estado, en el orden de las transiciones. */
export function accionesDisponibles(estado: EstadoCheque): AccionCheque[] {
  const destinos = TRANSICIONES_CHEQUE[estado];
  return (Object.keys(DESTINO_ACCION) as AccionCheque[]).filter((a) => destinos.includes(DESTINO_ACCION[a]));
}

// ----- Estado visible -------------------------------------------------------------

export type TonoCheque = "neutro" | "verde" | "ambar" | "rojo" | "azul";

export const TONO_ESTADO_CHEQUE: Record<EstadoCheque, TonoCheque> = {
  en_cartera: "azul",
  depositado: "verde",
  entregado: "neutro",
  rechazado: "rojo",
  anulado: "neutro",
};

/**
 * Estado para mostrar. Un rechazado está "ND pendiente" hasta que su nota de
 * débito se autoriza; entonces se muestra el número de la ND.
 */
export function estadoChequeVisible(cheque: {
  estado: EstadoCheque;
  nd_estado: EstadoComprobante | null;
  nd_numero_texto: string | null;
}): { texto: string; tono: TonoCheque; nd: string | null } {
  const tono = TONO_ESTADO_CHEQUE[cheque.estado];
  if (cheque.estado !== "rechazado") return { texto: NOMBRES_ESTADO_CHEQUE[cheque.estado], tono, nd: null };
  if (cheque.nd_estado === "autorizado" && cheque.nd_numero_texto) {
    return { texto: "Rechazado", tono, nd: `ND ${cheque.nd_numero_texto}` };
  }
  return { texto: "Rechazado – ND pendiente", tono, nd: "ND pendiente" };
}

// ----- Validación de un cambio de estado --------------------------------------------

export type DatosCambioCheque = {
  accion: AccionCheque;
  fecha: string;
  observacion?: string | null;
  /** Entregar: a quién (obligatorio). */
  entregadoA?: string | null;
  /** Rechazar: gastos bancarios (opcionales, con IVA en la ND). */
  gastosImporte?: number | null;
  gastosDescripcion?: string | null;
};

export type CambioCheque = {
  accion: AccionCheque;
  fecha: string;
  observacion: string | null;
  entregadoA: string | null;
  gastos: { importe: number; descripcion: string } | null;
};

const texto = (valor: string | null | undefined): string | null => {
  const limpio = (valor ?? "").trim();
  return limpio === "" ? null : limpio;
};

export function validarCambioCheque(
  estado: EstadoCheque,
  datos: DatosCambioCheque,
): { errores: string[] } | { cambio: CambioCheque } {
  const destino = DESTINO_ACCION[datos.accion];
  if (!puedePasar(estado, destino)) {
    return {
      errores: [
        `Un cheque ${NOMBRES_ESTADO_CHEQUE[estado].toLowerCase()} no se puede ${NOMBRES_ACCION_CHEQUE[datos.accion].toLowerCase()}.`,
      ],
    };
  }

  const errores: string[] = [];
  if (!esFechaValida(datos.fecha)) errores.push("Completá la fecha.");

  const entregadoA = datos.accion === "entregar" ? texto(datos.entregadoA) : null;
  if (datos.accion === "entregar" && !entregadoA) errores.push("Completá a quién se entregó el cheque.");

  let gastos: CambioCheque["gastos"] = null;
  if (datos.accion === "rechazar") {
    const importe = datos.gastosImporte ?? 0;
    const descripcion = texto(datos.gastosDescripcion);
    if (!Number.isFinite(importe) || importe < 0) errores.push("Los gastos bancarios no pueden ser negativos.");
    else if (aCentavos(importe) / 100 !== importe) errores.push("Los gastos bancarios van con hasta 2 decimales.");
    else if (importe > 0 && !descripcion) errores.push("Completá la descripción de los gastos bancarios.");
    else if (importe > 0 && descripcion) gastos = { importe, descripcion };
  }

  if (errores.length > 0) return { errores };
  return {
    cambio: { accion: datos.accion, fecha: datos.fecha, observacion: texto(datos.observacion), entregadoA, gastos },
  };
}
