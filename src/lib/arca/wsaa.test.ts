import forge from "node-forge";
import { describe, expect, it } from "vitest";
import { generarParPrueba } from "./certificados-prueba";
import {
  URL_WSAA,
  armarSobreLoginCms,
  armarTra,
  firmarTra,
  parsearRespuestaLogin,
  solicitarTicket,
} from "./wsaa";

const AHORA = new Date("2026-10-15T12:00:00Z");
const par = generarParPrueba();

const TICKET_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<loginTicketResponse version="1.0">
    <header>
        <source>CN=wsaahomo, O=AFIP, C=AR, SERIALNUMBER=CUIT 33693450239</source>
        <destination>SERIALNUMBER=CUIT 23334771229, CN=silfeerphomo</destination>
        <uniqueId>1453264537</uniqueId>
        <generationTime>2026-10-15T09:00:00.123-03:00</generationTime>
        <expirationTime>2026-10-15T21:00:00.123-03:00</expirationTime>
    </header>
    <credentials>
        <token>PD94bWwgdG9rZW4=</token>
        <sign>c2lnbg==</sign>
    </credentials>
</loginTicketResponse>`;

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LOGIN_OK = `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><loginCmsResponse xmlns="http://wsaa.view.ua.wsaa.afip.gov.ar"><loginCmsReturn>${escapar(TICKET_XML)}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;

const falla = (codigo: string, mensaje: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><soapenv:Body><soapenv:Fault><faultcode xmlns:ns1="http://xml.apache.org/axis/">${codigo}</faultcode><faultstring>${mensaje}</faultstring><detail><ns2:hostname xmlns:ns2="http://xml.apache.org/axis/">wsaaext1.homo.afip.gov.ar</ns2:hostname></detail></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;

describe("armarTra", () => {
  it("arma el pedido de ticket con ventana de ±10 minutos", () => {
    const tra = armarTra("wsfe", AHORA);
    expect(tra).toContain("<service>wsfe</service>");
    expect(tra).toContain(`<uniqueId>${Math.floor(AHORA.getTime() / 1000)}</uniqueId>`);
    expect(tra).toContain("<generationTime>2026-10-15T11:50:00-00:00</generationTime>");
    expect(tra).toContain("<expirationTime>2026-10-15T12:10:00-00:00</expirationTime>");
    expect(tra.startsWith('<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0">')).toBe(true);
  });
});

describe("firmarTra", () => {
  it("devuelve un CMS firmado con SHA-256 que incluye el TRA y el certificado", () => {
    const tra = armarTra("wsfe", AHORA);
    const cms = firmarTra(tra, par.certificadoPem, par.clavePem);
    const p7 = forge.pkcs7.messageFromAsn1(
      forge.asn1.fromDer(forge.util.decode64(cms)),
    ) as forge.pkcs7.PkcsSignedData & {
      rawCapture: {
        content: forge.asn1.Asn1;
        digestAlgorithm: string;
        authenticatedAttributes: forge.asn1.Asn1[];
      };
    };
    // forge no expone el contenido al parsear: se lee del [0] EXPLICIT capturado.
    const contenido = (p7.rawCapture.content.value as forge.asn1.Asn1[])[0];
    expect(contenido.value).toBe(tra);
    expect(p7.certificates).toHaveLength(1);
    expect(forge.asn1.derToOid(p7.rawCapture.digestAlgorithm)).toBe(forge.pki.oids.sha256);
    expect(p7.rawCapture.authenticatedAttributes).toHaveLength(3);
  });
});

describe("armarSobreLoginCms", () => {
  it("envuelve el CMS en el sobre SOAP de loginCms", () => {
    expect(armarSobreLoginCms("QUJD")).toBe(
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.ua.wsaa.afip.gov.ar"><soapenv:Body><wsaa:loginCms><wsaa:in0>QUJD</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>',
    );
  });
});

describe("parsearRespuestaLogin", () => {
  it("lee token, sign y vencimiento del ticket escapado", () => {
    expect(parsearRespuestaLogin(LOGIN_OK)).toEqual({
      ok: true,
      token: "PD94bWwgdG9rZW4=",
      sign: "c2lnbg==",
      expira: new Date("2026-10-16T00:00:00.123Z"),
    });
  });

  it("informa que ya hay un ticket vigente", () => {
    const r = parsearRespuestaLogin(
      falla("ns1:coe.alreadyAuthenticated", "El CEE ya posee un TA valido para el acceso al WSN solicitado"),
    );
    expect(r).toEqual({
      ok: false,
      codigo: "coe.alreadyAuthenticated",
      mensaje: "El CEE ya posee un TA valido para el acceso al WSN solicitado",
    });
  });

  it("informa un certificado sin autorización para el servicio", () => {
    const r = parsearRespuestaLogin(falla("ns1:coe.notAuthorized", "Computador no autorizado a acceder al servicio"));
    expect(r).toMatchObject({ ok: false, codigo: "coe.notAuthorized" });
  });

  it("informa un certificado no confiable", () => {
    const r = parsearRespuestaLogin(falla("ns1:cms.cert.untrusted", "Certificado no emitido por AC de confianza"));
    expect(r).toMatchObject({ ok: false, codigo: "cms.cert.untrusted", mensaje: "Certificado no emitido por AC de confianza" });
  });

  it("informa una respuesta que no se entiende", () => {
    expect(parsearRespuestaLogin("<html>Bad Gateway</html>")).toMatchObject({ ok: false, codigo: "respuesta.invalida" });
  });
});

describe("solicitarTicket", () => {
  it("firma, envía a WSAA del ambiente y devuelve el ticket", async () => {
    const llamadas: { url: string; init: RequestInit }[] = [];
    const fetchFalso = async (url: string | URL | Request, init?: RequestInit) => {
      llamadas.push({ url: String(url), init: init ?? {} });
      return new Response(LOGIN_OK, { status: 200 });
    };
    const r = await solicitarTicket(fetchFalso, "homologacion", par.certificadoPem, par.clavePem, AHORA);
    expect(r).toMatchObject({ ok: true, token: "PD94bWwgdG9rZW4=", sign: "c2lnbg==" });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0].url).toBe("https://wsaahomo.afip.gov.ar/ws/services/LoginCms");
    expect(llamadas[0].init.method).toBe("POST");
    const headers = new Headers(llamadas[0].init.headers);
    expect(headers.get("SOAPAction")).toBe('""');
    expect(headers.get("Content-Type")).toBe("text/xml; charset=utf-8");
    expect(String(llamadas[0].init.body)).toMatch(/<wsaa:in0>[A-Za-z0-9+/=]+<\/wsaa:in0>/);
  });

  it("devuelve la falla SOAP aunque la respuesta sea 500", async () => {
    const fetchFalso = async () =>
      new Response(falla("ns1:coe.alreadyAuthenticated", "El CEE ya posee un TA valido"), { status: 500 });
    const r = await solicitarTicket(fetchFalso, "produccion", par.certificadoPem, par.clavePem, AHORA);
    expect(r).toMatchObject({ ok: false, codigo: "coe.alreadyAuthenticated" });
  });

  it("usa la URL de producción", () => {
    expect(URL_WSAA.produccion).toBe("https://wsaa.afip.gov.ar/ws/services/LoginCms");
  });
});
