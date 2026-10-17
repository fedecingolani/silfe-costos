/**
 * WSFEv1: factura electrónica de ARCA (SOAP 1.1).
 * - FEDummy: estado de los servidores, sin autenticación.
 * - FECompUltimoAutorizado: último número autorizado de un punto de venta y tipo.
 * - FECAESolicitar: pide el CAE de un comprobante (concepto Productos, pesos).
 * - FECompConsultar: datos de un comprobante ya autorizado, para reconciliar
 *   una respuesta perdida.
 */
import type { AmbienteArca, CondicionIvaEmisor } from "@/lib/tipos";
import type { FetchArca } from "./wsaa";
import { desescaparXml, escaparXml, etiqueta } from "./xml";

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

// ----- FECAESolicitar ------------------------------------------------------

export type AlicuotaSolicitud = { id: number; base: number; importe: number };

export type AsociadoSolicitud = {
  tipo: number;
  puntoVenta: number;
  numero: number;
  /** CUIT del emisor del comprobante asociado. */
  cuit?: string;
  /** yyyy-mm-dd */
  fecha?: string;
};

/** Período asociado de una nota (PeriodoAsoc), en lugar de CbtesAsoc. Fechas yyyy-mm-dd. */
export type PeriodoSolicitud = { desde: string; hasta: string };

export type SolicitudCae = {
  puntoVenta: number;
  tipoComprobante: number;
  numero: number;
  /** yyyy-mm-dd */
  fecha: string;
  docTipo: number;
  docNro: string;
  condicionIvaReceptorId: number;
  /** Neto gravado (ImpNeto). */
  neto: number;
  /** Importe no gravado (ImpTotConc). */
  noGravado: number;
  iva: number;
  total: number;
  /**
   * Array Iva, sólo alícuotas gravadas. Vacío (sin ítems gravados) se omite:
   * con ImpIVA 0 ARCA sólo acepta el array con la alícuota 0% (10018), y lo
   * exige sólo si ImpNeto es mayor a cero (10070).
   */
  alicuotas: readonly AlicuotaSolicitud[];
  asociados?: readonly AsociadoSolicitud[];
  /** Período asociado de una nota. Excluyente con asociados. */
  periodo?: PeriodoSolicitud;
};

export type MensajeWsfe = { code: number; msg: string };

export type RespuestaCae = { observaciones: MensajeWsfe[]; errores: MensajeWsfe[] } & (
  | { resultado: "A"; cae: string; caeVencimiento: Date }
  | { resultado: "R"; cae: null; caeVencimiento: null }
);

/**
 * La respuesta de ARCA no permite saber si el comprobante quedó autorizado
 * (por ejemplo, un aprobado sin CAE o con un vencimiento ilegible). Quien
 * llama lo trata como una respuesta perdida: deja el comprobante en
 * verificación y lo reconcilia con FECompConsultar antes de reintentar.
 */
export class RespuestaArcaIncierta extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = "RespuestaArcaIncierta";
  }
}

/** Importe con 2 decimales, como lo espera WSFE. */
function importe(valor: number): string {
  if (!Number.isFinite(valor)) throw new Error(`Importe inválido para ARCA: ${valor}`);
  return valor.toFixed(2);
}

/** yyyy-mm-dd → yyyymmdd */
function fechaWsfe(fecha: string): string {
  return fecha.replace(/-/g, "");
}

/** yyyymmdd → fecha a las 00:00 UTC, o null si viene vacía o mal formada. */
function leerFecha(valor: string | null): Date | null {
  const partes = valor?.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!partes) return null;
  return new Date(Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3])));
}

/** Todas las apariciones de una etiqueta (con o sin prefijo de namespace). */
function todas(xml: string, nombre: string): string[] {
  const re = new RegExp(`<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1].trim());
}

/** Mensajes de <Obs> o <Err>: [{code, msg}]. */
function mensajes(xml: string | null, nombre: "Obs" | "Err"): MensajeWsfe[] {
  if (!xml) return [];
  return todas(xml, nombre).map((bloque) => ({
    code: Number(etiqueta(bloque, "Code")),
    msg: desescaparXml(etiqueta(bloque, "Msg") ?? ""),
  }));
}

function armarAsociados(asociados: readonly AsociadoSolicitud[] | undefined): string {
  if (!asociados || asociados.length === 0) return "";
  const filas = asociados.map(
    (a) =>
      `<CbteAsoc><Tipo>${a.tipo}</Tipo><PtoVta>${a.puntoVenta}</PtoVta><Nro>${a.numero}</Nro>` +
      (a.cuit ? `<Cuit>${escaparXml(a.cuit)}</Cuit>` : "") +
      (a.fecha ? `<CbteFch>${fechaWsfe(a.fecha)}</CbteFch>` : "") +
      "</CbteAsoc>",
  );
  return `<CbtesAsoc>${filas.join("")}</CbtesAsoc>`;
}

function armarPeriodo(periodo: PeriodoSolicitud | undefined): string {
  if (!periodo) return "";
  return (
    `<PeriodoAsoc><FchDesde>${fechaWsfe(periodo.desde)}</FchDesde>` +
    `<FchHasta>${fechaWsfe(periodo.hasta)}</FchHasta></PeriodoAsoc>`
  );
}

/**
 * Pide el CAE de un comprobante. El orden de los elementos sigue el WSDL de
 * FECAEDetRequest (… CbtesAsoc, Tributos, Iva, Opcionales, Compradores,
 * PeriodoAsoc, Actividades). Un rechazo de ARCA (Resultado R, Observaciones o Errors)
 * no se lanza: se devuelve para guardarlo tal cual en el comprobante.
 */
export async function feCAESolicitar(
  fetchArca: FetchArca,
  ambiente: AmbienteArca,
  auth: AuthWsfe,
  solicitud: SolicitudCae,
): Promise<RespuestaCae> {
  const s = solicitud;
  // ARCA admite los dos (10197), pero la app asocia una nota a una cosa o a la otra.
  if (s.periodo && s.asociados && s.asociados.length > 0) {
    throw new Error("Una nota se asocia a comprobantes o a un período, no a los dos.");
  }
  const iva = s.alicuotas
    .map((a) => `<AlicIva><Id>${a.id}</Id><BaseImp>${importe(a.base)}</BaseImp><Importe>${importe(a.importe)}</Importe></AlicIva>`)
    .join("");
  const detalle =
    `<Concepto>1</Concepto><DocTipo>${s.docTipo}</DocTipo><DocNro>${escaparXml(s.docNro)}</DocNro>` +
    `<CbteDesde>${s.numero}</CbteDesde><CbteHasta>${s.numero}</CbteHasta><CbteFch>${fechaWsfe(s.fecha)}</CbteFch>` +
    `<ImpTotal>${importe(s.total)}</ImpTotal><ImpTotConc>${importe(s.noGravado)}</ImpTotConc><ImpNeto>${importe(s.neto)}</ImpNeto>` +
    `<ImpOpEx>0.00</ImpOpEx><ImpTrib>0.00</ImpTrib><ImpIVA>${importe(s.iva)}</ImpIVA>` +
    `<MonId>PES</MonId><MonCotiz>1</MonCotiz><CondicionIVAReceptorId>${s.condicionIvaReceptorId}</CondicionIVAReceptorId>` +
    armarAsociados(s.asociados) +
    (iva ? `<Iva>${iva}</Iva>` : "") +
    armarPeriodo(s.periodo);

  const resultado = await llamar(
    fetchArca,
    ambiente,
    "FECAESolicitar",
    `${armarAuth(auth)}<FeCAEReq><FeCabReq><CantReg>1</CantReg><PtoVta>${s.puntoVenta}</PtoVta>` +
      `<CbteTipo>${s.tipoComprobante}</CbteTipo></FeCabReq><FeDetReq><FECAEDetRequest>${detalle}` +
      "</FECAEDetRequest></FeDetReq></FeCAEReq>",
  );

  const errores = mensajes(etiqueta(resultado, "Errors"), "Err");
  const det = etiqueta(resultado, "FECAEDetResponse");
  const cab = etiqueta(resultado, "FeCabResp");
  const codigo = (det && etiqueta(det, "Resultado")) ?? (cab && etiqueta(cab, "Resultado"));

  if (codigo !== "A" && codigo !== "R" && errores.length === 0) {
    throw new Error("WSFE no informó el resultado de FECAESolicitar.");
  }
  const aprobado = codigo === "A" && errores.length === 0;
  const observaciones = mensajes(det && etiqueta(det, "Observaciones"), "Obs");
  if (!aprobado) return { resultado: "R", cae: null, caeVencimiento: null, observaciones, errores };

  const cae = (det && etiqueta(det, "CAE")) || null;
  const caeVencimiento = leerFecha(det && etiqueta(det, "CAEFchVto"));
  if (!cae || !caeVencimiento) {
    throw new RespuestaArcaIncierta("ARCA aprobó el comprobante pero no informó el CAE o su vencimiento.");
  }
  return { resultado: "A", cae, caeVencimiento, observaciones, errores };
}

// ----- FECompConsultar -----------------------------------------------------

export type ComprobanteConsultado = {
  cae: string;
  caeVencimiento: Date | null;
  importeTotal: number;
  /** yyyy-mm-dd */
  fecha: string | null;
  docNro: string | null;
};

/** Código de WSFE para "no existen datos" en una consulta. */
const SIN_DATOS = "602";

/**
 * Datos de un comprobante en ARCA, o null si ARCA no lo tiene (602). Sirve
 * para saber si un pedido de CAE cuya respuesta se perdió llegó a autorizarse.
 */
export async function feCompConsultar(
  fetchArca: FetchArca,
  ambiente: AmbienteArca,
  auth: AuthWsfe,
  puntoVenta: number,
  tipoComprobante: number,
  numero: number,
): Promise<ComprobanteConsultado | null> {
  const resultado = await llamar(
    fetchArca,
    ambiente,
    "FECompConsultar",
    `${armarAuth(auth)}<FeCompConsReq><CbteTipo>${tipoComprobante}</CbteTipo><CbteNro>${numero}</CbteNro>` +
      `<PtoVta>${puntoVenta}</PtoVta></FeCompConsReq>`,
  );
  const errores = etiqueta(resultado, "Errors");
  if (errores && etiqueta(errores, "Code") === SIN_DATOS) return null;
  const error = errorArca(resultado);
  if (error) throw new Error(error);

  const datos = etiqueta(resultado, "ResultGet");
  const cae = datos && etiqueta(datos, "CodAutorizacion");
  if (!datos || !cae) throw new Error("WSFE no informó el CAE del comprobante consultado.");
  const fecha = leerFecha(etiqueta(datos, "CbteFch"));
  return {
    cae,
    caeVencimiento: leerFecha(etiqueta(datos, "FchVto")),
    importeTotal: Number(etiqueta(datos, "ImpTotal")),
    fecha: fecha ? fecha.toISOString().slice(0, 10) : null,
    docNro: etiqueta(datos, "DocNro"),
  };
}
