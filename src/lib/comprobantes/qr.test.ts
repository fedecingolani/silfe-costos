import { describe, expect, it } from "vitest";
import { URL_QR_ARCA, datosQr, urlQrArca } from "./qr";

const comprobante = {
  fecha: "2026-10-16",
  cuitEmisor: "30712345671",
  puntoVenta: 7,
  tipoArca: 1,
  numero: 361,
  total: 1210.5,
  docTipo: 80,
  docNro: "20111111112",
  cae: "76123456789012",
};

describe("datosQr", () => {
  it("arma el JSON de la especificación de ARCA con números", () => {
    expect(datosQr(comprobante)).toEqual({
      ver: 1,
      fecha: "2026-10-16",
      cuit: 30712345671,
      ptoVta: 7,
      tipoCmp: 1,
      nroCmp: 361,
      importe: 1210.5,
      moneda: "PES",
      ctz: 1,
      tipoDocRec: 80,
      nroDocRec: 20111111112,
      tipoCodAut: "E",
      codAut: 76123456789012,
    });
  });
});

describe("urlQrArca", () => {
  it("codifica el JSON en base64 en el parámetro p", () => {
    const url = urlQrArca(comprobante);
    expect(url.startsWith(`${URL_QR_ARCA}?p=`)).toBe(true);
    const p = url.slice(`${URL_QR_ARCA}?p=`.length);
    expect(JSON.parse(Buffer.from(p, "base64").toString("utf8"))).toEqual(datosQr(comprobante));
  });

  it("usa el dominio de ARCA", () => {
    expect(URL_QR_ARCA).toBe("https://www.arca.gob.ar/fe/qr/");
  });
});
