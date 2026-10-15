/**
 * Lectura y validación del certificado de ARCA y de su clave privada (PEM),
 * con node-forge. Se usa al subir las credenciales, antes de cifrar la clave.
 */
import forge from "node-forge";
import { normalizarCuit } from "./cuit";

export type DatosCertificado = {
  /** Nombre común (CN) del sujeto, el alias que se eligió al pedirlo. */
  titular: string | null;
  /** CUIT del sujeto (serialNumber "CUIT nnnnnnnnnnn"); null si no la tiene. */
  cuit: string | null;
  /** Nombre común de la autoridad que lo emitió. */
  emisor: string | null;
  vence: Date;
};

const OID_SERIAL_NUMBER = "2.5.4.5";

function campo(atributos: forge.pki.Certificate["subject"], filtro: { name?: string; type?: string }) {
  const valor = atributos.getField(filtro)?.value;
  return typeof valor === "string" ? valor : null;
}

function leerCertificado(pem: string): forge.pki.Certificate {
  try {
    return forge.pki.certificateFromPem(pem);
  } catch {
    throw new Error("No se pudo leer el certificado.");
  }
}

function leerClave(pem: string): forge.pki.rsa.PrivateKey {
  try {
    return forge.pki.privateKeyFromPem(pem) as forge.pki.rsa.PrivateKey;
  } catch {
    throw new Error("No se pudo leer la clave privada.");
  }
}

export function analizarCertificado(pem: string): DatosCertificado {
  const cert = leerCertificado(pem);
  const serial = campo(cert.subject, { type: OID_SERIAL_NUMBER });
  const cuit = serial?.match(/CUIT\s*(\d{2}-?\d{8}-?\d)/)?.[1];
  return {
    titular: campo(cert.subject, { name: "commonName" }),
    cuit: cuit ? normalizarCuit(cuit) : null,
    emisor: campo(cert.issuer, { name: "commonName" }),
    vence: cert.validity.notAfter,
  };
}

function corresponden(clave: forge.pki.rsa.PrivateKey, cert: forge.pki.Certificate): boolean {
  const publica = cert.publicKey as forge.pki.rsa.PublicKey;
  return publica.n?.equals(clave.n) === true && publica.e?.equals(clave.e) === true;
}

/** true si la clave privada es la del certificado (mismo módulo RSA). */
export function claveCorrespondeACertificado(clavePem: string, certificadoPem: string): boolean {
  return corresponden(leerClave(clavePem), leerCertificado(certificadoPem));
}

const fechaAr = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Argentina/Buenos_Aires",
});

/**
 * Controles al subir las credenciales. Devuelve los problemas encontrados,
 * listos para mostrar; una lista vacía significa que se pueden guardar.
 */
export function validarCredencial(datos: {
  certificadoPem: string;
  clavePem: string;
  cuitEmisor: string;
  ahora: Date;
}): string[] {
  const errores: string[] = [];

  let cert: forge.pki.Certificate | null = null;
  try {
    cert = leerCertificado(datos.certificadoPem);
  } catch {
    errores.push("No se pudo leer el certificado. Subí el archivo .crt que descargaste de ARCA.");
  }

  let clave: forge.pki.rsa.PrivateKey | null = null;
  try {
    clave = leerClave(datos.clavePem);
  } catch {
    errores.push(
      "No se pudo leer la clave privada. Subí el archivo .key con el que generaste el pedido del certificado.",
    );
  }

  if (cert && clave && !corresponden(clave, cert)) {
    errores.push("La clave privada no corresponde a este certificado.");
  }

  if (cert) {
    const { cuit, vence } = analizarCertificado(datos.certificadoPem);
    const cuitEmisor = normalizarCuit(datos.cuitEmisor);
    if (!cuit) {
      errores.push("El certificado no tiene una CUIT. Revisá que sea el que emitió ARCA.");
    } else if (cuit !== cuitEmisor) {
      errores.push(`El certificado es de la CUIT ${cuit} y el emisor está configurado con ${cuitEmisor}.`);
    }
    if (vence.getTime() <= datos.ahora.getTime()) {
      errores.push(`El certificado venció el ${fechaAr.format(vence)}.`);
    }
    const desde = cert.validity.notBefore;
    if (desde.getTime() > datos.ahora.getTime()) {
      errores.push(`El certificado empieza a valer el ${fechaAr.format(desde)}.`);
    }
  }

  return errores;
}
