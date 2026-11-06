/**
 * Medios de pago de una orden de pago: efectivo, transferencia, cheques de
 * terceros de la cartera y cheques propios. Un cheque de terceros va siempre
 * por su importe (lo pone la base) y se entrega una sola vez por orden; la
 * pantalla no ofrece los que ya se eligieron en otro medio.
 */
import { esFechaValida } from "@/lib/comprobantes/validacion";
import { aCentavos, sumarPesos, textoPesos } from "@/lib/cobranzas/dinero";
import type { EstadoCheque, MedioOrdenPagoGuardar, TipoMedioPagoCompra } from "@/lib/tipos";

/** Cheque de terceros que se ofrece o que ya eligió un borrador. fechaPago yyyy-mm-dd. */
export type ChequeCartera = {
  id: string;
  banco: string;
  numero: string;
  fechaPago: string;
  importe: number;
  librador: string | null;
  /** Cliente que lo entregó. */
  cliente: string | null;
  estado: EstadoCheque;
};

/** Medio tal como lo edita la pantalla. importe NaN: lo escrito no es un número. */
export type MedioBorrador = {
  tipo: TipoMedioPagoCompra;
  importe: number;
  /** Transferencia. */
  referencia: string | null;
  /** Cheque de terceros. */
  chequeId: string | null;
  /** Cheque propio. */
  banco: string | null;
  numero: string | null;
  fechaPago: string | null;
};

type Cheques = ReadonlyMap<string, ChequeCartera>;

/** Importe del medio: el del cheque para un cheque de terceros (NaN si no se eligió o no se conoce). */
export function importeMedio(medio: MedioBorrador, cheques: Cheques): number {
  if (medio.tipo !== "cheque_tercero") return medio.importe;
  const cheque = medio.chequeId ? cheques.get(medio.chequeId) : undefined;
  return cheque ? cheque.importe : Number.NaN;
}

/** Total de la orden: suma exacta a centavos de los medios legibles. */
export function totalMedios(medios: readonly MedioBorrador[], cheques: Cheques): number {
  return sumarPesos(medios.map((m) => importeMedio(m, cheques)).filter((i) => Number.isFinite(i)));
}

const texto = (valor: string | null): string | null => (valor && valor.trim() !== "" ? valor.trim() : null);

/** Errores de los medios, sin repetir el mismo mensaje. */
export function validarMedios(medios: readonly MedioBorrador[], cheques: Cheques): string[] {
  if (medios.length === 0) return ["Cargá al menos un medio de pago."];
  const errores = new Set<string>();
  const elegidos = new Set<string>();
  for (const medio of medios) {
    if (medio.tipo === "cheque_tercero") {
      if (!medio.chequeId) {
        errores.add("Elegí el cheque de terceros de la cartera.");
        continue;
      }
      if (elegidos.has(medio.chequeId)) {
        errores.add("Cada cheque de terceros se entrega una sola vez.");
        continue;
      }
      elegidos.add(medio.chequeId);
      const cheque = cheques.get(medio.chequeId);
      if (!cheque) errores.add("Uno de los cheques elegidos ya no está en la cartera.");
      else if (cheque.estado !== "en_cartera") errores.add(`El cheque ${cheque.banco} N° ${cheque.numero} ya no está en la cartera.`);
      continue;
    }
    if (!Number.isFinite(medio.importe) || aCentavos(medio.importe) <= 0) {
      errores.add("El importe de cada medio de pago tiene que ser mayor que cero.");
    }
    if (
      medio.tipo === "cheque_propio" &&
      (!texto(medio.banco) || !texto(medio.numero) || !esFechaValida(medio.fechaPago))
    ) {
      errores.add("Cada cheque propio lleva banco, número y fecha de pago.");
    }
  }
  return [...errores];
}

/** Cheques que puede elegir un medio: los de la cartera menos los elegidos en otros medios. */
export function chequesElegibles(
  cartera: readonly ChequeCartera[],
  elegidos: readonly (string | null)[],
  propio: string | null,
): ChequeCartera[] {
  const ocupados = new Set(elegidos.filter((id): id is string => id !== null && id !== propio));
  return cartera.filter((c) => !ocupados.has(c.id));
}

const normalizar = (valor: string): string =>
  valor
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Busca por banco, número, librador o cliente; sin tildes ni mayúsculas. */
export function buscarCheques(cheques: readonly ChequeCartera[], busqueda: string): ChequeCartera[] {
  const buscado = normalizar(busqueda.trim());
  if (buscado === "") return [...cheques];
  return cheques.filter((c) =>
    normalizar([c.banco, c.numero, c.librador ?? "", c.cliente ?? ""].join(" ")).includes(buscado),
  );
}

/** "Nación N° 0001 · pago 01/12/2026 · $ 1.000,00" */
export function textoCheque(cheque: ChequeCartera): string {
  const [anio, mes, dia] = cheque.fechaPago.split("-");
  return `${cheque.banco} N° ${cheque.numero} · pago ${dia}/${mes}/${anio} · ${textoPesos(cheque.importe)}`;
}

/** Medio en la forma de p_medios de guardar_orden_pago. */
export function medioParaGuardar(medio: MedioBorrador): MedioOrdenPagoGuardar {
  switch (medio.tipo) {
    case "efectivo":
      return { tipo: "efectivo", importe: medio.importe };
    case "transferencia":
      return { tipo: "transferencia", importe: medio.importe, referencia: texto(medio.referencia) };
    case "cheque_tercero":
      return { tipo: "cheque_tercero", cheque_id: medio.chequeId ?? "" };
    case "cheque_propio":
      return {
        tipo: "cheque_propio",
        importe: medio.importe,
        banco: texto(medio.banco) ?? "",
        numero: texto(medio.numero) ?? "",
        fecha_pago: medio.fechaPago ?? "",
      };
  }
}
