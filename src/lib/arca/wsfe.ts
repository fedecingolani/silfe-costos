/**
 * WSFEv1: factura electrónica de ARCA (SOAP 1.1). Por ahora sólo las
 * operaciones para probar la conexión: FEDummy (estado de los servidores,
 * sin autenticación) y FECompUltimoAutorizado (último número autorizado de
 * un punto de venta y tipo de comprobante).
 */
import type { AmbienteArca, CondicionIvaEmisor } from "@/lib/tipos";
import type { FetchArca } from "./wsaa";
import { escaparXml, etiqueta } from "./xml";

export const URL_WSFE: Record<AmbienteArca, string> = {
  homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
};

const NAMESPACE = "http://ar.gov.afip.dif.FEV1/";

export type AuthWsfe = { token: string; sign: string; cuit: string };

export type EstadoServidores = { app: string; db: string; auth: string };

/** Factura A (1) para Responsable Inscripto; Factura C (11) para Monotributista y Exento. */
export function tipoComprobantePorDefecto(condicionIva: CondicionIvaEmisor): number {
  return condicionIva === "Responsable Inscripto" ? 1 : 11;
}

function armarAuth(auth: AuthWsfe): string {
  return (
    `<Auth><Token>${escaparXml(auth.token)}</Token><Sign>${escaparXml(auth.sign)}</Sign>` +
    `<Cuit>${escaparXml(auth.cuit)}</Cuit></Auth>`
  );
}

async function llamar(
  fetchArca: FetchArca,
  ambiente: AmbienteArca,
  operacion: string,
  contenido: string,
): Promise<string> {
  const respuesta = await fetchArca(URL_WSFE[ambiente], {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `${NAMESPACE}${operacion}` },
    body:
      '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">' +
      `<soap:Body><${operacion} xmlns="${NAMESPACE}">${contenido}</${operacion}></soap:Body></soap:Envelope>`,
  });
  const xml = await respuesta.text();
  const resultado = etiqueta(xml, `${operacion}Result`);
  if (resultado === null) {
    const falla = etiqueta(xml, "faultstring");
    throw new Error(
      falla
        ? `WSFE rechazó ${operacion}: ${falla}`
        : `WSFE respondió ${respuesta.status} a ${operacion} con una respuesta que no se pudo leer.`,
    );
  }
  return resultado;
}

/** Primer error de un bloque <Errors><Err><Code/><Msg/></Err></Errors>, si lo hay. */
function errorArca(resultado: string): string | null {
  const errores = etiqueta(resultado, "Errors");
  if (!errores) return null;
  const codigo = etiqueta(errores, "Code");
  const mensaje = etiqueta(errores, "Msg");
  return `ARCA respondió ${codigo ?? "un error"}: ${mensaje ?? "sin detalle"}`;
}

export async function feDummy(fetchArca: FetchArca, ambiente: AmbienteArca): Promise<EstadoServidores> {
  const resultado = await llamar(fetchArca, ambiente, "FEDummy", "");
  return {
    app: etiqueta(resultado, "AppServer") ?? "?",
    db: etiqueta(resultado, "DbServer") ?? "?",
    auth: etiqueta(resultado, "AuthServer") ?? "?",
  };
}

export async function feCompUltimoAutorizado(
  fetchArca: FetchArca,
  ambiente: AmbienteArca,
  auth: AuthWsfe,
  puntoVenta: number,
  tipoComprobante: number,
): Promise<number> {
  const resultado = await llamar(
    fetchArca,
    ambiente,
    "FECompUltimoAutorizado",
    `${armarAuth(auth)}<PtoVta>${puntoVenta}</PtoVta><CbteTipo>${tipoComprobante}</CbteTipo>`,
  );
  const error = errorArca(resultado);
  if (error) throw new Error(error);
  // Number(null) y Number("") dan 0: se exige el texto con dígitos antes de convertir.
  const numero = etiqueta(resultado, "CbteNro");
  if (numero === null || !/^\d+$/.test(numero)) {
    throw new Error("WSFE no informó el número del último comprobante.");
  }
  return Number(numero);
}
