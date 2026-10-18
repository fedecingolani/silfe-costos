/**
 * Código QR obligatorio de los comprobantes electrónicos (RG 4892). El QR
 * lleva una URL de ARCA con los datos del comprobante en JSON, codificados
 * en base64 en el parámetro `p` (base64 estándar, como en el ejemplo de la
 * especificación). Acá sólo se arma la URL; la imagen se genera al hacer
 * el PDF.
 *
 * La especificación original usa https://www.afip.gob.ar/fe/qr/. Desde el
 * cambio de AFIP a ARCA el dominio vigente es arca.gob.ar; afip.gob.ar
 * sigue redirigiendo, así que los QR ya impresos con ese dominio siguen
 * funcionando.
 */

export const URL_QR_ARCA = "https://www.arca.gob.ar/fe/qr/";

export type ComprobanteQr = {
  /** yyyy-mm-dd */
  fecha: string;
  cuitEmisor: string;
  puntoVenta: number;
  tipoArca: number;
  numero: number;
  total: number;
  docTipo: number;
  docNro: string;
  cae: string;
};

export type DatosQr = {
  ver: 1;
  fecha: string;
  cuit: number;
  ptoVta: number;
  tipoCmp: number;
  nroCmp: number;
  importe: number;
  moneda: string;
  ctz: number;
  tipoDocRec: number;
  nroDocRec: number;
  tipoCodAut: "E";
  codAut: number;
};

/** JSON del QR. Moneda pesos, cotización 1, autorización por CAE ("E"). */
export function datosQr(c: ComprobanteQr): DatosQr {
  return {
    ver: 1,
    fecha: c.fecha,
    cuit: Number(c.cuitEmisor),
    ptoVta: c.puntoVenta,
    tipoCmp: c.tipoArca,
    nroCmp: c.numero,
    importe: c.total,
    moneda: "PES",
    ctz: 1,
    tipoDocRec: c.docTipo,
    nroDocRec: Number(c.docNro),
    tipoCodAut: "E",
    codAut: Number(c.cae),
  };
}

export function urlQrArca(c: ComprobanteQr): string {
  // El JSON es ASCII (números y códigos), así que btoa alcanza; existe en el Worker y en Node.
  return `${URL_QR_ARCA}?p=${btoa(JSON.stringify(datosQr(c)))}`;
}
