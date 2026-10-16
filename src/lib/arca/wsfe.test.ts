import { describe, expect, it } from "vitest";
import {
  RespuestaArcaIncierta,
  URL_WSFE,
  feCAESolicitar,
  feCompConsultar,
  feCompUltimoAutorizado,
  feDummy,
  tipoComprobantePorDefecto,
  type SolicitudCae,
} from "./wsfe";

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

// ----- FECAESolicitar ------------------------------------------------------

const cabResp = (resultado: string) =>
  `<FeCabResp><Cuit>23334771229</Cuit><PtoVta>7</PtoVta><CbteTipo>1</CbteTipo><FchProceso>20261016103015</FchProceso><CantReg>1</CantReg><Resultado>${resultado}</Resultado><Reproceso>N</Reproceso></FeCabResp>`;

const caeRespuesta = (contenido: string) =>
  sobre(
    `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>${contenido}</FECAESolicitarResult></FECAESolicitarResponse>`,
  );

const CAE_APROBADO = caeRespuesta(
  cabResp("A") +
    "<FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>80</DocTipo><DocNro>20111111112</DocNro>" +
    "<CbteDesde>361</CbteDesde><CbteHasta>361</CbteHasta><CbteFch>20261016</CbteFch><Resultado>A</Resultado>" +
    "<Observaciones><Obs><Code>10217</Code><Msg>El credito fiscal discriminado en el presente comprobante solo podra ser computado a efectos del Procedimiento permanente de transicion al Regimen General.</Msg></Obs></Observaciones>" +
    "<CAE>76123456789012</CAE><CAEFchVto>20261026</CAEFchVto></FECAEDetResponse></FeDetResp>",
);

const CAE_RECHAZADO_NO_CORRELATIVO = caeRespuesta(
  cabResp("R") +
    "<FeDetResp><FECAEDetResponse><Concepto>1</Concepto><DocTipo>80</DocTipo><DocNro>20111111112</DocNro>" +
    "<CbteDesde>365</CbteDesde><CbteHasta>365</CbteHasta><CbteFch>20261016</CbteFch><Resultado>R</Resultado>" +
    "<Observaciones><Obs><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado.</Msg></Obs>" +
    "<Obs><Code>10048</Code><Msg>Msg 2</Msg></Obs></Observaciones>" +
    "<CAE></CAE><CAEFchVto></CAEFchVto></FECAEDetResponse></FeDetResp>",
);

const CAE_ERRORES = caeRespuesta(
  cabResp("R") +
    "<Errors><Err><Code>10242</Code><Msg>El campo Condicion Frente al IVA del receptor resulta obligatorio.</Msg></Err></Errors>",
);

const CAE_SIN_AUTENTICAR = caeRespuesta(
  "<Errors><Err><Code>600</Code><Msg>ValidacionDeToken: No apareció CUIT en lista de relaciones: 23334771229</Msg></Err></Errors>",
);

const SOLICITUD: SolicitudCae = {
  puntoVenta: 7,
  tipoComprobante: 1,
  numero: 361,
  fecha: "2026-10-16",
  docTipo: 80,
  docNro: "20111111112",
  condicionIvaReceptorId: 1,
  neto: 1100,
  iva: 220.5,
  total: 1320.5,
  alicuotas: [
    { id: 4, base: 100, importe: 10.5 },
    { id: 5, base: 1000, importe: 210 },
  ],
};

describe("feCAESolicitar", () => {
  it("arma FECAEReq con cabecera, detalle, importes con 2 decimales y alícuotas", async () => {
    const { llamadas, fetchFalso } = fetchQueResponde(CAE_APROBADO);
    await feCAESolicitar(fetchFalso, "homologacion", AUTH, SOLICITUD);
    expect(llamadas[0].url).toBe("https://wswhomo.afip.gov.ar/wsfev1/service.asmx");
    const headers = new Headers(llamadas[0].init.headers);
    expect(headers.get("SOAPAction")).toBe("http://ar.gov.afip.dif.FEV1/FECAESolicitar");
    const cuerpo = String(llamadas[0].init.body);
    expect(cuerpo).toContain("<Auth><Token>T0K</Token><Sign>S1G</Sign><Cuit>23334771229</Cuit></Auth>");
    expect(cuerpo).toContain("<FeCabReq><CantReg>1</CantReg><PtoVta>7</PtoVta><CbteTipo>1</CbteTipo></FeCabReq>");
    expect(cuerpo).toContain(
      "<FECAEDetRequest><Concepto>1</Concepto><DocTipo>80</DocTipo><DocNro>20111111112</DocNro>" +
        "<CbteDesde>361</CbteDesde><CbteHasta>361</CbteHasta><CbteFch>20261016</CbteFch>" +
        "<ImpTotal>1320.50</ImpTotal><ImpTotConc>0.00</ImpTotConc><ImpNeto>1100.00</ImpNeto>" +
        "<ImpOpEx>0.00</ImpOpEx><ImpTrib>0.00</ImpTrib><ImpIVA>220.50</ImpIVA>" +
        "<MonId>PES</MonId><MonCotiz>1</MonCotiz><CondicionIVAReceptorId>1</CondicionIVAReceptorId>" +
        "<Iva><AlicIva><Id>4</Id><BaseImp>100.00</BaseImp><Importe>10.50</Importe></AlicIva>" +
        "<AlicIva><Id>5</Id><BaseImp>1000.00</BaseImp><Importe>210.00</Importe></AlicIva></Iva>" +
        "</FECAEDetRequest>",
    );
    expect(cuerpo).not.toContain("CbtesAsoc");
  });

  it("incluye los comprobantes asociados de una nota de crédito", async () => {
    const { llamadas, fetchFalso } = fetchQueResponde(CAE_APROBADO);
    await feCAESolicitar(fetchFalso, "homologacion", AUTH, {
      ...SOLICITUD,
      tipoComprobante: 3,
      asociados: [{ tipo: 1, puntoVenta: 7, numero: 150, cuit: "23334771229", fecha: "2026-01-10" }],
    });
    expect(String(llamadas[0].init.body)).toContain(
      "<CondicionIVAReceptorId>1</CondicionIVAReceptorId><CbtesAsoc><CbteAsoc><Tipo>1</Tipo><PtoVta>7</PtoVta>" +
        "<Nro>150</Nro><Cuit>23334771229</Cuit><CbteFch>20260110</CbteFch></CbteAsoc></CbtesAsoc><Iva>",
    );
  });

  it("devuelve el CAE, su vencimiento y las observaciones de un aprobado", async () => {
    const { fetchFalso } = fetchQueResponde(CAE_APROBADO);
    expect(await feCAESolicitar(fetchFalso, "produccion", AUTH, SOLICITUD)).toEqual({
      resultado: "A",
      cae: "76123456789012",
      caeVencimiento: new Date(Date.UTC(2026, 9, 26)),
      observaciones: [
        {
          code: 10217,
          msg: "El credito fiscal discriminado en el presente comprobante solo podra ser computado a efectos del Procedimiento permanente de transicion al Regimen General.",
        },
      ],
      errores: [],
    });
  });

  it("devuelve el rechazo por número no correlativo con todas sus observaciones", async () => {
    const { fetchFalso } = fetchQueResponde(CAE_RECHAZADO_NO_CORRELATIVO);
    const respuesta = await feCAESolicitar(fetchFalso, "homologacion", AUTH, SOLICITUD);
    expect(respuesta.resultado).toBe("R");
    expect(respuesta.cae).toBeNull();
    expect(respuesta.caeVencimiento).toBeNull();
    expect(respuesta.observaciones.map((o) => o.code)).toEqual([10016, 10048]);
    expect(respuesta.errores).toEqual([]);
  });

  it("devuelve los errores de validación como rechazo", async () => {
    const { fetchFalso } = fetchQueResponde(CAE_ERRORES);
    expect(await feCAESolicitar(fetchFalso, "homologacion", AUTH, SOLICITUD)).toEqual({
      resultado: "R",
      cae: null,
      caeVencimiento: null,
      observaciones: [],
      errores: [{ code: 10242, msg: "El campo Condicion Frente al IVA del receptor resulta obligatorio." }],
    });
  });

  it("trata como rechazo un error sin cabecera (por ejemplo, de autenticación)", async () => {
    const { fetchFalso } = fetchQueResponde(CAE_SIN_AUTENTICAR);
    const respuesta = await feCAESolicitar(fetchFalso, "homologacion", AUTH, SOLICITUD);
    expect(respuesta.resultado).toBe("R");
    expect(respuesta.errores).toEqual([
      { code: 600, msg: "ValidacionDeToken: No apareció CUIT en lista de relaciones: 23334771229" },
    ]);
  });

  it("lanza RespuestaArcaIncierta si un aprobado no trae el CAE o su vencimiento", async () => {
    const sinCae = caeRespuesta(
      cabResp("A") +
        "<FeDetResp><FECAEDetResponse><CbteDesde>361</CbteDesde><Resultado>A</Resultado>" +
        "<CAE></CAE><CAEFchVto>20261026</CAEFchVto></FECAEDetResponse></FeDetResp>",
    );
    const vencimientoMalo = caeRespuesta(
      cabResp("A") +
        "<FeDetResp><FECAEDetResponse><CbteDesde>361</CbteDesde><Resultado>A</Resultado>" +
        "<CAE>76123456789012</CAE><CAEFchVto>2026-10-26</CAEFchVto></FECAEDetResponse></FeDetResp>",
    );
    for (const xml of [sinCae, vencimientoMalo]) {
      const { fetchFalso } = fetchQueResponde(xml);
      const promesa = feCAESolicitar(fetchFalso, "homologacion", AUTH, SOLICITUD);
      await expect(promesa).rejects.toBeInstanceOf(RespuestaArcaIncierta);
      await expect(promesa).rejects.toThrow("ARCA aprobó el comprobante pero no informó el CAE o su vencimiento.");
    }
  });

  it("falla si la respuesta no trae resultado ni errores", async () => {
    const { fetchFalso } = fetchQueResponde(caeRespuesta(""));
    await expect(feCAESolicitar(fetchFalso, "homologacion", AUTH, SOLICITUD)).rejects.toThrow(
      "WSFE no informó el resultado de FECAESolicitar.",
    );
  });

  it("falla si se pide un importe que no es un número finito", async () => {
    const { fetchFalso } = fetchQueResponde(CAE_APROBADO);
    await expect(
      feCAESolicitar(fetchFalso, "homologacion", AUTH, { ...SOLICITUD, total: Number.NaN }),
    ).rejects.toThrow("Importe inválido para ARCA: NaN");
  });
});

// ----- FECompConsultar -----------------------------------------------------

const consultaRespuesta = (contenido: string) =>
  sobre(
    `<FECompConsultarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompConsultarResult>${contenido}</FECompConsultarResult></FECompConsultarResponse>`,
  );

const CONSULTA_ENCONTRADO = consultaRespuesta(
  "<ResultGet><Concepto>1</Concepto><DocTipo>80</DocTipo><DocNro>20111111112</DocNro><CbteDesde>361</CbteDesde>" +
    "<CbteHasta>361</CbteHasta><CbteFch>20261016</CbteFch><ImpTotal>1320.5</ImpTotal><ImpTotConc>0</ImpTotConc>" +
    "<ImpNeto>1100</ImpNeto><ImpOpEx>0</ImpOpEx><ImpTrib>0</ImpTrib><ImpIVA>220.5</ImpIVA><FchServDesde/><FchServHasta/>" +
    "<FchVtoPago/><MonId>PES</MonId><MonCotiz>1</MonCotiz><Iva><AlicIva><Id>5</Id><BaseImp>1000</BaseImp><Importe>210</Importe></AlicIva></Iva>" +
    "<Resultado>A</Resultado><CodAutorizacion>76123456789012</CodAutorizacion><EmisionTipo>CAE</EmisionTipo>" +
    "<FchVto>20261026</FchVto><FchProceso>20261016103015</FchProceso><PtoVta>7</PtoVta><CbteTipo>1</CbteTipo></ResultGet>",
);

const CONSULTA_NO_EXISTE = consultaRespuesta(
  "<Errors><Err><Code>602</Code><Msg>No existen datos en nuestros registros para los parametros ingresados.</Msg></Err></Errors>",
);

describe("feCompConsultar", () => {
  it("consulta un comprobante por punto de venta, tipo y número", async () => {
    const { llamadas, fetchFalso } = fetchQueResponde(CONSULTA_ENCONTRADO);
    expect(await feCompConsultar(fetchFalso, "homologacion", AUTH, 7, 1, 361)).toEqual({
      cae: "76123456789012",
      caeVencimiento: new Date(Date.UTC(2026, 9, 26)),
      importeTotal: 1320.5,
      fecha: "2026-10-16",
      docNro: "20111111112",
    });
    const headers = new Headers(llamadas[0].init.headers);
    expect(headers.get("SOAPAction")).toBe("http://ar.gov.afip.dif.FEV1/FECompConsultar");
    expect(String(llamadas[0].init.body)).toContain(
      "</Auth><FeCompConsReq><CbteTipo>1</CbteTipo><CbteNro>361</CbteNro><PtoVta>7</PtoVta></FeCompConsReq>",
    );
  });

  it("devuelve null si ARCA no tiene el comprobante (602)", async () => {
    const { fetchFalso } = fetchQueResponde(CONSULTA_NO_EXISTE);
    expect(await feCompConsultar(fetchFalso, "homologacion", AUTH, 7, 1, 362)).toBeNull();
  });

  it("informa otros errores de ARCA", async () => {
    const { fetchFalso } = fetchQueResponde(CONSULTA_NO_EXISTE.replace("<Code>602</Code>", "<Code>600</Code>"));
    await expect(feCompConsultar(fetchFalso, "homologacion", AUTH, 7, 1, 362)).rejects.toThrow(
      "ARCA respondió 600: No existen datos en nuestros registros para los parametros ingresados.",
    );
  });

  it("falla si el comprobante encontrado no trae CAE", async () => {
    const sinCae = CONSULTA_ENCONTRADO.replace("<CodAutorizacion>76123456789012</CodAutorizacion>", "");
    const { fetchFalso } = fetchQueResponde(sinCae);
    await expect(feCompConsultar(fetchFalso, "homologacion", AUTH, 7, 1, 361)).rejects.toThrow(
      "WSFE no informó el CAE del comprobante consultado.",
    );
  });
});
