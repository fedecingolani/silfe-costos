import { describe, expect, it } from "vitest";
import { obtenerTicket, mensajeErrorWsaa, type AlmacenTicket, type EstadoTicketGuardado } from "./acceso";
import { generarParPrueba } from "./certificados-prueba";
import { cifrar, descifrar, generarClaveCifrado } from "./cifrado";

const AHORA = new Date("2026-10-15T12:00:00Z");
const en = (ms: number) => new Date(AHORA.getTime() + ms).toISOString();
const CLAVE = generarClaveCifrado();
const par = generarParPrueba();

const escapar = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const LOGIN_OK = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><loginCmsResponse><loginCmsReturn>${escapar(
  "<loginTicketResponse><header><expirationTime>2026-10-16T00:00:00.000-03:00</expirationTime></header><credentials><token>TOK-NUEVO</token><sign>SIG-NUEVO</sign></credentials></loginTicketResponse>",
)}</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>`;

const falla = (codigo: string, mensaje: string) =>
  `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode>ns1:${codigo}</faultcode><faultstring>${mensaje}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;

/** Almacén en memoria con la misma semántica que la tabla arca_credencial. */
function almacenFalso(inicial: Partial<EstadoTicketGuardado> = {}) {
  const fila: EstadoTicketGuardado = { taCifrado: null, taExpira: null, taBloqueadoHasta: null, ...inicial };
  const eventos: string[] = [];
  const almacen: AlmacenTicket = {
    async leer() {
      return { ...fila };
    },
    async tomarBloqueo(hasta, ahora) {
      const libre = fila.taBloqueadoHasta === null || new Date(fila.taBloqueadoHasta) < ahora;
      eventos.push(libre ? "bloqueo" : "bloqueo-perdido");
      if (libre) fila.taBloqueadoHasta = hasta.toISOString();
      return libre;
    },
    async guardar(taCifrado, expira) {
      eventos.push("guardar");
      fila.taCifrado = taCifrado;
      fila.taExpira = expira.toISOString();
      fila.taBloqueadoHasta = null;
    },
    async liberarBloqueo(hasta) {
      eventos.push("liberar");
      if (fila.taBloqueadoHasta === hasta.toISOString()) fila.taBloqueadoHasta = null;
    },
  };
  return { almacen, fila, eventos };
}

function fetchQueResponde(xml: string, status = 200) {
  let llamadas = 0;
  const fetchArca = async () => {
    llamadas++;
    return new Response(xml, { status });
  };
  return { fetchArca, llamadas: () => llamadas };
}

async function opciones(almacen: AlmacenTicket, fetchArca: (url: string, init: RequestInit) => Promise<Response>) {
  const claveCifrada = await cifrar(par.clavePem, CLAVE);
  const esperas: number[] = [];
  return {
    esperas,
    opciones: {
      almacen,
      fetchArca,
      ambiente: "homologacion" as const,
      claveCifrado: CLAVE,
      certificadoPem: par.certificadoPem,
      claveCifrada,
      reloj: () => AHORA,
      esperar: async (ms: number) => {
        esperas.push(ms);
      },
    },
  };
}

describe("obtenerTicket", () => {
  it("reutiliza el ticket guardado si está vigente, sin llamar a WSAA", async () => {
    const taCifrado = await cifrar(JSON.stringify({ token: "TOK", sign: "SIG" }), CLAVE);
    const { almacen, eventos } = almacenFalso({ taCifrado, taExpira: en(60 * 60_000) });
    const red = fetchQueResponde(LOGIN_OK);
    const { opciones: o } = await opciones(almacen, red.fetchArca);
    const ticket = await obtenerTicket(o);
    expect(ticket).toEqual({ token: "TOK", sign: "SIG", expira: new Date(en(60 * 60_000)), origen: "reutilizado" });
    expect(red.llamadas()).toBe(0);
    expect(eventos).toEqual([]);
  });

  it("pide uno nuevo con el bloqueo tomado, lo guarda cifrado y libera el bloqueo", async () => {
    const { almacen, fila, eventos } = almacenFalso();
    const red = fetchQueResponde(LOGIN_OK);
    const { opciones: o } = await opciones(almacen, red.fetchArca);
    const ticket = await obtenerTicket(o);
    expect(ticket).toMatchObject({ token: "TOK-NUEVO", sign: "SIG-NUEVO", origen: "nuevo" });
    expect(ticket.expira).toEqual(new Date("2026-10-16T03:00:00.000Z"));
    expect(red.llamadas()).toBe(1);
    expect(eventos).toEqual(["bloqueo", "guardar", "liberar"]);
    expect(fila.taCifrado).not.toContain("TOK-NUEVO");
    expect(JSON.parse(await descifrar(fila.taCifrado!, CLAVE))).toEqual({ token: "TOK-NUEVO", sign: "SIG-NUEVO" });
    expect(fila.taExpira).toBe("2026-10-16T03:00:00.000Z");
    expect(fila.taBloqueadoHasta).toBeNull();
  });

  it("pide uno nuevo si el guardado vence en menos de 5 minutos", async () => {
    const taCifrado = await cifrar(JSON.stringify({ token: "VIEJO", sign: "SIG" }), CLAVE);
    const { almacen } = almacenFalso({ taCifrado, taExpira: en(60_000) });
    const red = fetchQueResponde(LOGIN_OK);
    const { opciones: o } = await opciones(almacen, red.fetchArca);
    expect(await obtenerTicket(o)).toMatchObject({ token: "TOK-NUEVO", origen: "nuevo" });
  });

  it("espera mientras otro pedido tiene el bloqueo y usa el ticket que guardó", async () => {
    const { almacen, fila } = almacenFalso({ taBloqueadoHasta: en(30_000) });
    const red = fetchQueResponde(LOGIN_OK);
    const { opciones: o, esperas } = await opciones(almacen, red.fetchArca);
    const taCifrado = await cifrar(JSON.stringify({ token: "DEL-OTRO", sign: "SIG" }), CLAVE);
    o.esperar = async (ms: number) => {
      esperas.push(ms);
      // El otro pedido termina mientras se espera.
      fila.taCifrado = taCifrado;
      fila.taExpira = en(12 * 60 * 60_000);
      fila.taBloqueadoHasta = null;
    };
    expect(await obtenerTicket(o)).toMatchObject({ token: "DEL-OTRO", origen: "reutilizado" });
    expect(esperas).toHaveLength(1);
    expect(red.llamadas()).toBe(0);
  });

  it("si el bloqueo no se libera, se rinde en unos 3 segundos con un error legible", async () => {
    const { almacen } = almacenFalso({ taBloqueadoHasta: en(50_000) });
    const red = fetchQueResponde(LOGIN_OK);
    const { opciones: o, esperas } = await opciones(almacen, red.fetchArca);
    await expect(obtenerTicket(o)).rejects.toThrow(/Otro pedido está obteniendo el ticket de ARCA/);
    expect(esperas.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3000);
    expect(red.llamadas()).toBe(0);
  });

  it("si pierde el bloqueo por una carrera, reintenta en lugar de pedir otro ticket", async () => {
    const { almacen, eventos } = almacenFalso();
    const red = fetchQueResponde(LOGIN_OK);
    const { opciones: o } = await opciones(almacen, red.fetchArca);
    let primera = true;
    const tomar = almacen.tomarBloqueo;
    almacen.tomarBloqueo = async (hasta, ahora) => {
      if (primera) {
        primera = false;
        eventos.push("bloqueo-perdido");
        return false;
      }
      return tomar(hasta, ahora);
    };
    expect(await obtenerTicket(o)).toMatchObject({ origen: "nuevo" });
    expect(eventos).toEqual(["bloqueo-perdido", "bloqueo", "guardar", "liberar"]);
  });

  it("libera el bloqueo aunque WSAA falle", async () => {
    const { almacen, fila, eventos } = almacenFalso();
    const red = fetchQueResponde(falla("coe.notAuthorized", "Computador no autorizado"), 500);
    const { opciones: o } = await opciones(almacen, red.fetchArca);
    await expect(obtenerTicket(o)).rejects.toThrow(/no está autorizado/);
    expect(eventos).toEqual(["bloqueo", "liberar"]);
    expect(fila.taBloqueadoHasta).toBeNull();
    expect(fila.taCifrado).toBeNull();
  });

  it("explica coe.alreadyAuthenticated: hay que esperar a que venza el ticket anterior", async () => {
    const { almacen } = almacenFalso();
    const red = fetchQueResponde(falla("coe.alreadyAuthenticated", "El CEE ya posee un TA valido"), 500);
    const { opciones: o } = await opciones(almacen, red.fetchArca);
    await expect(obtenerTicket(o)).rejects.toThrow(/hasta 12 horas/);
  });
});

describe("mensajeErrorWsaa", () => {
  it("traduce los códigos conocidos a mensajes legibles", () => {
    expect(mensajeErrorWsaa("coe.alreadyAuthenticated", "x")).toMatch(/no llegó a guardar.*hasta 12 horas/);
    expect(mensajeErrorWsaa("coe.notAuthorized", "x")).toMatch(/no está autorizado.*wsfe/);
    expect(mensajeErrorWsaa("cms.cert.untrusted", "x")).toMatch(/no reconoce el certificado/);
  });

  it("muestra el código y el mensaje de WSAA para el resto", () => {
    expect(mensajeErrorWsaa("cms.bad", "Firma inválida")).toBe("WSAA rechazó el pedido de ticket (cms.bad): Firma inválida");
  });
});
