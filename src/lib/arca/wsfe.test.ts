import { describe, expect, it } from "vitest";
import { URL_WSFE, feCompUltimoAutorizado, feDummy, tipoComprobantePorDefecto } from "./wsfe";

const sobre = (cuerpo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;

const DUMMY_OK = sobre(
  '<FEDummyResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FEDummyResult><AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer></FEDummyResult></FEDummyResponse>',
);

const ULTIMO_OK = sobre(
  '<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>1</CbteTipo><CbteNro>0</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>',
);

const ULTIMO_ERROR = sobre(
  '<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult><PtoVta>3</PtoVta><CbteTipo>1</CbteTipo><CbteNro>0</CbteNro><Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>',
);

type Llamada = { url: string; init: RequestInit };

function fetchQueResponde(xml: string, status = 200) {
  const llamadas: Llamada[] = [];
  const fetchFalso = async (url: string | URL | Request, init?: RequestInit) => {
    llamadas.push({ url: String(url), init: init ?? {} });
    return new Response(xml, { status });
  };
  return { llamadas, fetchFalso };
}

const AUTH = { token: "T0K", sign: "S1G", cuit: "23334771229" };

describe("feDummy", () => {
  it("devuelve el estado de los servidores", async () => {
    const { llamadas, fetchFalso } = fetchQueResponde(DUMMY_OK);
    expect(await feDummy(fetchFalso, "homologacion")).toEqual({ app: "OK", db: "OK", auth: "OK" });
    expect(llamadas[0].url).toBe("https://wswhomo.afip.gov.ar/wsfev1/service.asmx");
    const headers = new Headers(llamadas[0].init.headers);
    expect(headers.get("SOAPAction")).toBe("http://ar.gov.afip.dif.FEV1/FEDummy");
    expect(String(llamadas[0].init.body)).toContain('<FEDummy xmlns="http://ar.gov.afip.dif.FEV1/"></FEDummy>');
  });

  it("falla con un error legible si la respuesta no se entiende", async () => {
    const { fetchFalso } = fetchQueResponde("<html>Service Unavailable</html>", 503);
    await expect(feDummy(fetchFalso, "produccion")).rejects.toThrow(/WSFE respondió 503/);
  });

  it("informa la falla SOAP con su faultstring", async () => {
    const { fetchFalso } = fetchQueResponde(
      sobre("<soap:Fault><faultcode>soap:Server</faultcode><faultstring>Servidor no disponible</faultstring></soap:Fault>"),
      500,
    );
    await expect(feDummy(fetchFalso, "homologacion")).rejects.toThrow("WSFE rechazó FEDummy: Servidor no disponible");
  });
});

describe("feCompUltimoAutorizado", () => {
  it("devuelve el número del último comprobante autorizado", async () => {
    const { llamadas, fetchFalso } = fetchQueResponde(ULTIMO_OK);
    expect(await feCompUltimoAutorizado(fetchFalso, "produccion", AUTH, 3, 1)).toBe(0);
    expect(llamadas[0].url).toBe("https://servicios1.afip.gov.ar/wsfev1/service.asmx");
    const headers = new Headers(llamadas[0].init.headers);
    expect(headers.get("SOAPAction")).toBe("http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado");
    expect(String(llamadas[0].init.body)).toContain(
      "<Auth><Token>T0K</Token><Sign>S1G</Sign><Cuit>23334771229</Cuit></Auth><PtoVta>3</PtoVta><CbteTipo>1</CbteTipo>",
    );
  });

  it("informa los errores de ARCA con código y mensaje", async () => {
    const { fetchFalso } = fetchQueResponde(ULTIMO_ERROR);
    await expect(feCompUltimoAutorizado(fetchFalso, "homologacion", AUTH, 3, 1)).rejects.toThrow(
      "ARCA respondió 602: No existen datos en nuestros registros para los parametros ingresados.",
    );
  });

  it("falla si no informa el número del último comprobante", async () => {
    const sinNumero = ULTIMO_OK.replace("<CbteNro>0</CbteNro>", "");
    const { fetchFalso } = fetchQueResponde(sinNumero);
    await expect(feCompUltimoAutorizado(fetchFalso, "homologacion", AUTH, 3, 1)).rejects.toThrow(
      "WSFE no informó el número del último comprobante.",
    );
  });

  it("falla si el número del último comprobante viene vacío", async () => {
    const vacio = ULTIMO_OK.replace("<CbteNro>0</CbteNro>", "<CbteNro></CbteNro>");
    const { fetchFalso } = fetchQueResponde(vacio);
    await expect(feCompUltimoAutorizado(fetchFalso, "homologacion", AUTH, 3, 1)).rejects.toThrow(
      "WSFE no informó el número del último comprobante.",
    );
  });

  it("falla si el número del último comprobante no es un número", async () => {
    const raro = ULTIMO_OK.replace("<CbteNro>0</CbteNro>", "<CbteNro>abc</CbteNro>");
    const { fetchFalso } = fetchQueResponde(raro);
    await expect(feCompUltimoAutorizado(fetchFalso, "homologacion", AUTH, 3, 1)).rejects.toThrow(
      "WSFE no informó el número del último comprobante.",
    );
  });

  it("devuelve números mayores a cero", async () => {
    const { fetchFalso } = fetchQueResponde(ULTIMO_OK.replace("<CbteNro>0</CbteNro>", "<CbteNro>152</CbteNro>"));
    expect(await feCompUltimoAutorizado(fetchFalso, "homologacion", AUTH, 3, 1)).toBe(152);
  });

  it("escapa el token y el sign en el XML", async () => {
    const { llamadas, fetchFalso } = fetchQueResponde(ULTIMO_OK);
    await feCompUltimoAutorizado(fetchFalso, "homologacion", { ...AUTH, token: "a<b&c" }, 3, 1);
    expect(String(llamadas[0].init.body)).toContain("<Token>a&lt;b&amp;c</Token>");
  });
});

describe("tipoComprobantePorDefecto", () => {
  it("usa Factura A para Responsable Inscripto y Factura C para el resto", () => {
    expect(tipoComprobantePorDefecto("Responsable Inscripto")).toBe(1);
    expect(tipoComprobantePorDefecto("Monotributista")).toBe(11);
    expect(tipoComprobantePorDefecto("Exento")).toBe(11);
  });
});

describe("URL_WSFE", () => {
  it("tiene una URL por ambiente", () => {
    expect(URL_WSFE).toEqual({
      homologacion: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
      produccion: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
    });
  });
});
