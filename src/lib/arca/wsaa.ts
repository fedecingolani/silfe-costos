/**
 * WSAA: autenticación de ARCA. Se firma un pedido de ticket (TRA) con el
 * certificado y la clave privada del emisor (CMS/PKCS#7, SHA-256) y WSAA
 * devuelve un ticket de acceso (token y sign) que vale 12 horas.
 *
 * Firmar en JS puro cuesta CPU (~23 ms en Workers): el ticket se reutiliza
 * mientras esté vigente (ver ticket.ts). Mientras haya uno vigente, WSAA
 * rechaza un login nuevo con coe.alreadyAuthenticated.
 */
import forge from "node-forge";
import type { AmbienteArca } from "@/lib/tipos";
import { desescaparXml, etiqueta } from "./xml";

export type FetchArca = (url: string, init: RequestInit) => Promise<Response>;

export const URL_WSAA: Record<AmbienteArca, string> = {
  homologacion: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  produccion: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
};

/** Ventana de validez del TRA alrededor de "ahora", para tolerar relojes desfasados. */
const VENTANA_TRA_MS = 10 * 60_000;

export type RespuestaLogin =
  | { ok: true; token: string; sign: string; expira: Date }
  | { ok: false; codigo: string; mensaje: string };

/** Fecha ISO en UTC sin milisegundos, con el sufijo -00:00 que acepta WSAA. */
function fechaTra(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "-00:00");
}

/** Pedido de ticket de acceso (loginTicketRequest) para un servicio, p. ej. "wsfe". */
export function armarTra(servicio: string, ahora: Date): string {
  const ms = ahora.getTime();
  return (
    '<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(ms / 1000)}</uniqueId>` +
    `<generationTime>${fechaTra(ms - VENTANA_TRA_MS)}</generationTime>` +
    `<expirationTime>${fechaTra(ms + VENTANA_TRA_MS)}</expirationTime>` +
    `</header><service>${servicio}</service></loginTicketRequest>`
  );
}

/**
 * Firma el TRA como CMS SignedData con el contenido incluido, el certificado
 * adjunto y los atributos contentType, messageDigest y signingTime (= ahora).
 * Devuelve el CMS en base64 (DER).
 */
export function firmarTra(tra: string, certificadoPem: string, clavePem: string, ahora: Date): string {
  const cert = forge.pki.certificateFromPem(certificadoPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(clavePem),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      // forge acepta un Date en signingTime aunque los tipos digan string.
      { type: forge.pki.oids.signingTime, value: ahora as unknown as string },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

export function armarSobreLoginCms(cms: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
    'xmlns:wsaa="http://wsaa.view.ua.wsaa.afip.gov.ar"><soapenv:Body><wsaa:loginCms>' +
    `<wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`
  );
}

/**
 * Lee la respuesta de loginCms. El ticket viene como XML escapado dentro de
 * loginCmsReturn; los errores vienen como SOAP Fault con un faultcode tipo
 * "ns1:coe.alreadyAuthenticated" (se devuelve sin el prefijo).
 */
export function parsearRespuestaLogin(xml: string): RespuestaLogin {
  const claro = desescaparXml(xml);
  const token = etiqueta(claro, "token");
  const sign = etiqueta(claro, "sign");
  const expiracion = etiqueta(claro, "expirationTime");
  if (token && sign && expiracion) {
    const expira = new Date(expiracion);
    if (!Number.isNaN(expira.getTime())) return { ok: true, token, sign, expira };
  }

  const codigo = etiqueta(claro, "faultcode");
  if (codigo) {
    return {
      ok: false,
      codigo: codigo.replace(/^[\w-]+:/, ""),
      mensaje: etiqueta(claro, "faultstring") ?? "WSAA rechazó el pedido sin explicar el motivo.",
    };
  }

  return { ok: false, codigo: "respuesta.invalida", mensaje: "WSAA devolvió una respuesta que no se pudo leer." };
}

/** Pide un ticket de acceso a WSFE. No reintenta: decidir cuándo pedir es tarea de ticket.ts. */
export async function solicitarTicket(
  fetchArca: FetchArca,
  ambiente: AmbienteArca,
  certificadoPem: string,
  clavePem: string,
  ahora: Date,
): Promise<RespuestaLogin> {
  const cms = firmarTra(armarTra("wsfe", ahora), certificadoPem, clavePem, ahora);
  const respuesta = await fetchArca(URL_WSAA[ambiente], {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: '""' },
    body: armarSobreLoginCms(cms),
  });
  // Los SOAP Fault llegan con status 500: se lee el cuerpo igual.
  const resultado = parsearRespuestaLogin(await respuesta.text());
  if (!resultado.ok && resultado.codigo === "respuesta.invalida") {
    return { ...resultado, mensaje: `${resultado.mensaje} (HTTP ${respuesta.status})` };
  }
  return resultado;
}
