/**
 * Ticket de acceso de WSAA guardado en arca_credencial. Sólo se usa en el
 * servidor: descifra la clave privada y el ticket.
 *
 * Firmar es caro y WSAA rechaza un login nuevo mientras haya un ticket
 * vigente, así que el ticket se guarda cifrado y se reutiliza (ver
 * decidirTicket). Para que dos pedidos simultáneos no pidan ticket a la vez,
 * antes de pedir uno se toma un bloqueo corto en la fila; quien no lo
 * consigue espera un poco y vuelve a leer.
 *
 * La base se accede con un AlmacenTicket para poder probar esta lógica sin
 * Supabase; la implementación real está en src/lib/arca/almacen-ticket.ts.
 */
import type { AmbienteArca, TicketAcceso } from "@/lib/tipos";
import { cifrar, descifrar } from "./cifrado";
import { BLOQUEO_TICKET_MS, decidirTicket } from "./ticket";
import { solicitarTicket, type FetchArca } from "./wsaa";

export type EstadoTicketGuardado = {
  taCifrado: string | null;
  taExpira: string | null;
  taBloqueadoHasta: string | null;
};

export type AlmacenTicket = {
  leer(): Promise<EstadoTicketGuardado>;
  /**
   * Toma el bloqueo hasta `hasta` sólo si está libre (nulo o vencido a
   * `ahora`). Devuelve false si otro pedido lo tomó primero.
   */
  tomarBloqueo(hasta: Date, ahora: Date): Promise<boolean>;
  /** Guarda el ticket cifrado y su vencimiento, y libera el bloqueo. */
  guardar(taCifrado: string, expira: Date): Promise<void>;
  /** Libera el bloqueo sólo si sigue siendo el que se tomó con `hasta`. */
  liberarBloqueo(hasta: Date): Promise<void>;
};

export type TicketObtenido = TicketAcceso & { origen: "reutilizado" | "nuevo" };

/** Pausa entre intentos mientras otro pedido tiene el bloqueo. */
export const ESPERA_TICKET_MS = 500;
/** Cantidad de pausas antes de rendirse (6 × 500 ms = 3 s). */
export const INTENTOS_TICKET = 6;

const MENSAJES_WSAA: Record<string, string> = {
  "coe.alreadyAuthenticated":
    "ARCA ya entregó un ticket de acceso que la app no llegó a guardar y no da otro mientras ese siga vigente. " +
    "Hay que esperar a que venza (hasta 12 horas) y volver a probar.",
  "coe.notAuthorized":
    "El certificado no está autorizado para factura electrónica (wsfe). En ARCA, entrá a " +
    "\"Administrador de Relaciones de Clave Fiscal\" y asociá el servicio al certificado.",
  "cms.cert.untrusted":
    "ARCA no reconoce el certificado en este ambiente. Revisá que el certificado de homologación " +
    "esté cargado en homologación y el de producción en producción.",
};

/** Mensaje para mostrar cuando WSAA rechaza el pedido de ticket. */
export function mensajeErrorWsaa(codigo: string, mensaje: string): string {
  return MENSAJES_WSAA[codigo] ?? `WSAA rechazó el pedido de ticket (${codigo}): ${mensaje}`;
}

async function leerTicket(estado: EstadoTicketGuardado, claveCifrado: string): Promise<TicketObtenido> {
  const { token, sign } = JSON.parse(await descifrar(estado.taCifrado!, claveCifrado)) as {
    token: string;
    sign: string;
  };
  return { token, sign, expira: new Date(estado.taExpira!), origen: "reutilizado" };
}

function decidir(estado: EstadoTicketGuardado, ahora: Date) {
  // Sin ticket guardado no hay nada que reutilizar, aunque haya vencimiento.
  return decidirTicket(
    { taExpira: estado.taCifrado ? estado.taExpira : null, taBloqueadoHasta: estado.taBloqueadoHasta },
    ahora,
  );
}

export async function obtenerTicket(opciones: {
  almacen: AlmacenTicket;
  fetchArca: FetchArca;
  ambiente: AmbienteArca;
  /** Secreto ARCA_CLAVE_CIFRADO. */
  claveCifrado: string;
  certificadoPem: string;
  claveCifrada: string;
  reloj?: () => Date;
  esperar?: (ms: number) => Promise<void>;
}): Promise<TicketObtenido> {
  const { almacen, claveCifrado } = opciones;
  const reloj = opciones.reloj ?? (() => new Date());
  const esperar = opciones.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let intento = 0; ; intento++) {
    const ahora = reloj();
    const estado = await almacen.leer();
    const decision = decidir(estado, ahora);
    if (decision === "reutilizar") return leerTicket(estado, claveCifrado);

    if (decision === "solicitar") {
      const hasta = new Date(ahora.getTime() + BLOQUEO_TICKET_MS);
      if (await almacen.tomarBloqueo(hasta, ahora)) {
        try {
          return await solicitarYGuardar(opciones, ahora);
        } finally {
          // Si liberar falla, el bloqueo vence solo en BLOQUEO_TICKET_MS: no
          // se tapa el error original.
          await almacen.liberarBloqueo(hasta).catch(() => undefined);
        }
      }
    }

    if (intento >= INTENTOS_TICKET) {
      throw new Error("Otro pedido está obteniendo el ticket de ARCA. Probá de nuevo en un minuto.");
    }
    await esperar(ESPERA_TICKET_MS);
  }
}

async function solicitarYGuardar(
  opciones: Parameters<typeof obtenerTicket>[0],
  ahora: Date,
): Promise<TicketObtenido> {
  const { almacen, claveCifrado } = opciones;
  // Entre la lectura y el bloqueo otro pedido pudo haber guardado un ticket.
  const estado = await almacen.leer();
  if (decidir({ ...estado, taBloqueadoHasta: null }, ahora) === "reutilizar") {
    return leerTicket(estado, claveCifrado);
  }

  const clavePem = await descifrar(opciones.claveCifrada, claveCifrado);
  const respuesta = await solicitarTicket(
    opciones.fetchArca,
    opciones.ambiente,
    opciones.certificadoPem,
    clavePem,
    ahora,
  );
  if (!respuesta.ok) throw new Error(mensajeErrorWsaa(respuesta.codigo, respuesta.mensaje));

  const { token, sign, expira } = respuesta;
  await almacen.guardar(await cifrar(JSON.stringify({ token, sign }), claveCifrado), expira);
  return { token, sign, expira, origen: "nuevo" };
}
