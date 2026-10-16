/**
 * Letra, tipo de comprobante y documento del receptor según su condición
 * frente al IVA. El emisor es Responsable Inscripto: emite A a
 * Responsables Inscriptos y Monotributistas, y B a Exentos y Consumidores
 * Finales.
 */
import { validarCuit } from "@/lib/clientes/validaciones";
import type {
  ClaseComprobante,
  CondicionIva,
  LetraComprobante,
  TipoComprobanteArca,
} from "@/lib/tipos";

const LETRA_POR_CONDICION: Record<CondicionIva, LetraComprobante> = {
  "Responsable Inscripto": "A",
  Monotributista: "A",
  Exento: "B",
  "Consumidor Final": "B",
};

const TIPO_ARCA: Record<LetraComprobante, Record<ClaseComprobante, TipoComprobanteArca>> = {
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

export function letraDe(condicionIva: CondicionIva): LetraComprobante {
  return LETRA_POR_CONDICION[condicionIva];
}

/** Letra y código de ARCA. Falla si el cliente no tiene condición IVA. */
export function letraYTipo(
  condicionIva: CondicionIva | null | undefined,
  clase: ClaseComprobante,
): { letra: LetraComprobante; tipoArca: TipoComprobanteArca } {
  if (!condicionIva) throw new Error(MENSAJE_SIN_CONDICION_IVA);
  const letra = letraDe(condicionIva);
  return { letra, tipoArca: TIPO_ARCA[letra][clase] };
}

export function condicionIvaReceptorId(condicionIva: CondicionIva): number {
  return CONDICION_IVA_RECEPTOR_ID[condicionIva];
}

export type DocumentoReceptor = { docTipo: 80 | 99; docNro: string };

/**
 * Documento del receptor para WSFE. Letra A: CUIT válida obligatoria (80).
 * Letra B: la CUIT si es válida; si no, 99 ("sin identificar") con número 0.
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
