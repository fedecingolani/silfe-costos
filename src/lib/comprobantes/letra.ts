/**
 * Letra, tipo de comprobante y documento del receptor según su condición
 * frente al IVA. El emisor es Responsable Inscripto: emite A a
 * Responsables Inscriptos y Monotributistas, y B a Exentos y Consumidores
 * Finales. En un punto de venta no electrónico la letra es siempre X, sin
 * código de ARCA.
 */
import { validarCuit } from "@/lib/clientes/validaciones";
import type {
  ClaseComprobante,
  CondicionIva,
  LetraArca,
  LetraComprobante,
  TipoComprobanteArca,
} from "@/lib/tipos";

/** Letra y código de un comprobante de ARCA (A o B). */
export type LetraYTipoArca = { letra: LetraArca; tipoArca: TipoComprobanteArca };
/** Letra y código de cualquier comprobante: X no tiene código de ARCA. */
export type LetraYTipo = LetraYTipoArca | { letra: "X"; tipoArca: null };

const LETRA_X = { letra: "X", tipoArca: null } as const;

const LETRA_POR_CONDICION: Record<CondicionIva, LetraArca> = {
  "Responsable Inscripto": "A",
  Monotributista: "A",
  Exento: "B",
  "Consumidor Final": "B",
};

const TIPO_ARCA: Record<LetraArca, Record<ClaseComprobante, TipoComprobanteArca>> = {
  A: { factura: 1, nota_debito: 2, nota_credito: 3 },
  B: { factura: 6, nota_debito: 7, nota_credito: 8 },
};

/** CondicionIVAReceptorId de WSFE. */
const CONDICION_IVA_RECEPTOR_ID: Record<CondicionIva, number> = {
  "Responsable Inscripto": 1,
  Exento: 4,
  "Consumidor Final": 5,
  Monotributista: 6,
};

export const MENSAJE_SIN_CONDICION_IVA = "Completá la condición frente al IVA del cliente.";

export function letraDe(condicionIva: CondicionIva): LetraArca {
  return LETRA_POR_CONDICION[condicionIva];
}

/**
 * Letra y código de ARCA. En un punto de venta no electrónico
 * (`electronico` false) es X sin código, sin mirar la condición IVA; si no,
 * falla si el cliente no tiene condición IVA.
 */
export function letraYTipo(condicionIva: CondicionIva | null | undefined, clase: ClaseComprobante): LetraYTipoArca;
export function letraYTipo(
  condicionIva: CondicionIva | null | undefined,
  clase: ClaseComprobante,
  electronico: boolean,
): LetraYTipo;
export function letraYTipo(
  condicionIva: CondicionIva | null | undefined,
  clase: ClaseComprobante,
  electronico = true,
): LetraYTipo {
  if (!electronico) return { ...LETRA_X };
  if (!condicionIva) throw new Error(MENSAJE_SIN_CONDICION_IVA);
  const letra = letraDe(condicionIva);
  return { letra, tipoArca: TIPO_ARCA[letra][clase] };
}

/** Código de ARCA de una clase con una letra dada. Una X no tiene: null. */
export function tipoArcaDe(letra: LetraArca, clase: ClaseComprobante): TipoComprobanteArca;
export function tipoArcaDe(letra: LetraComprobante, clase: ClaseComprobante): TipoComprobanteArca | null;
export function tipoArcaDe(letra: LetraComprobante, clase: ClaseComprobante): TipoComprobanteArca | null {
  return letra === "X" ? null : TIPO_ARCA[letra][clase];
}

/**
 * Letra y código de una nota de crédito o débito: la letra del comprobante
 * asociado (ARCA exige la misma), no la que daría hoy la condición IVA del
 * cliente; si difieren, devuelve un aviso. Sin asociado, o en una factura,
 * es la del cliente (letraYTipo). En un punto de venta no electrónico
 * (`electronico` false) es X sin código ni aviso.
 */
export function letraYTipoNota(
  condicionIva: CondicionIva | null | undefined,
  clase: ClaseComprobante,
  letraAsociado: LetraArca | null,
): LetraYTipoArca & { aviso: string | null };
export function letraYTipoNota(
  condicionIva: CondicionIva | null | undefined,
  clase: ClaseComprobante,
  letraAsociado: LetraComprobante | null,
  electronico: boolean,
): LetraYTipo & { aviso: string | null };
export function letraYTipoNota(
  condicionIva: CondicionIva | null | undefined,
  clase: ClaseComprobante,
  letraAsociado: LetraComprobante | null,
  electronico = true,
): LetraYTipo & { aviso: string | null } {
  if (!electronico) return { ...LETRA_X, aviso: null };
  // Una X sólo se asocia a una X (lo controla la base): en un punto
  // electrónico, sin una letra de ARCA en el asociado vale la del cliente.
  if (clase === "factura" || !letraAsociado || letraAsociado === "X") {
    return { ...letraYTipo(condicionIva, clase), aviso: null };
  }
  const letraCliente = condicionIva ? letraDe(condicionIva) : null;
  return {
    letra: letraAsociado,
    tipoArca: TIPO_ARCA[letraAsociado][clase],
    aviso:
      letraCliente && letraCliente !== letraAsociado
        ? `El cliente hoy es ${condicionIva} (letra ${letraCliente}), pero la nota lleva la letra ${letraAsociado} ` +
          "del comprobante asociado, como exige ARCA."
        : null,
  };
}

export function condicionIvaReceptorId(condicionIva: CondicionIva): number {
  return CONDICION_IVA_RECEPTOR_ID[condicionIva];
}

export type DocumentoReceptor = { docTipo: 80 | 99; docNro: string };

/**
 * Documento del receptor para WSFE. Letra A: CUIT válida obligatoria (80).
 * Letras B y X: la CUIT si es válida; si no, 99 ("sin identificar") con
 * número 0.
 */
export function documentoReceptor(
  cuit: string | null | undefined,
  condicionIva: CondicionIva,
  letra: LetraComprobante,
): DocumentoReceptor {
  const validacion = validarCuit(cuit);
  const cuitValida = validacion.valido && validacion.normalizado !== null ? validacion.normalizado : null;
  if (cuitValida) return { docTipo: 80, docNro: cuitValida };
  if (letra === "A") {
    throw new Error(`Para un comprobante A el cliente (${condicionIva}) necesita una CUIT válida.`);
  }
  return { docTipo: 99, docNro: "0" };
}
