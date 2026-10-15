/**
 * Certificados y claves descartables para los tests de ARCA. Sólo lo
 * importan los *.test.ts: genera claves RSA de 1024 bits (rápidas) y
 * certificados con el mismo formato de sujeto que emite ARCA.
 */
import forge from "node-forge";

export type ParPrueba = { clavePem: string; certificadoPem: string };

type OpcionesCertificado = {
  cuit?: string;
  titular?: string;
  desde?: Date;
  hasta?: Date;
};

const claves = new Map<string, forge.pki.rsa.KeyPair>();

/** Par de claves RSA cacheado por nombre, para no generarlo en cada test. */
function clave(nombre: string): forge.pki.rsa.KeyPair {
  let par = claves.get(nombre);
  if (!par) {
    par = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 });
    claves.set(nombre, par);
  }
  return par;
}

export function generarParPrueba(nombreClave = "principal", opciones: OpcionesCertificado = {}): ParPrueba {
  const par = clave(nombreClave);
  const cert = forge.pki.createCertificate();
  cert.publicKey = par.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = opciones.desde ?? new Date("2026-01-01T00:00:00Z");
  cert.validity.notAfter = opciones.hasta ?? new Date("2028-01-01T00:00:00Z");
  cert.setSubject([
    { name: "commonName", value: opciones.titular ?? "silfeerphomo" },
    { type: "2.5.4.5", value: `CUIT ${opciones.cuit ?? "23334771229"}` },
  ]);
  cert.setIssuer([
    { name: "commonName", value: "Computadores Test" },
    { name: "organizationName", value: "AFIP" },
    { name: "countryName", value: "AR" },
  ]);
  cert.sign(par.privateKey, forge.md.sha256.create());
  return {
    clavePem: forge.pki.privateKeyToPem(par.privateKey),
    certificadoPem: forge.pki.certificateToPem(cert),
  };
}
