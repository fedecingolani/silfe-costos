import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { almacenTicket } from "./almacen-ticket";

type Respuesta = { data: unknown; error: { message: string } | null };

/**
 * Cliente de Supabase falso: cada consulta encadenada registra sus llamadas
 * y, al esperarla, devuelve la siguiente respuesta de la cola.
 */
function supabaseFalso(respuestas: Respuesta[]) {
  const consultas: string[][] = [];
  const cliente = {
    from(tabla: string) {
      const llamadas = [`from(${tabla})`];
      consultas.push(llamadas);
      const consulta: Record<string, unknown> = {
        then(resolver: (r: Respuesta) => unknown, rechazar: (e: unknown) => unknown) {
          const respuesta = respuestas.shift();
          return respuesta ? Promise.resolve(respuesta).then(resolver) : Promise.reject(new Error("sin respuesta")).catch(rechazar);
        },
      };
      for (const metodo of ["select", "update", "eq", "or", "single"]) {
        consulta[metodo] = (...args: unknown[]) => {
          llamadas.push(`${metodo}(${args.map((a) => JSON.stringify(a)).join(",")})`);
          return consulta;
        };
      }
      return consulta;
    },
  };
  return { consultas, cliente: cliente as unknown as Parameters<typeof almacenTicket>[0] };
}

const AHORA = new Date("2026-10-16T12:00:00.000Z");
const HASTA = new Date("2026-10-16T12:01:00.000Z");

describe("almacenTicket", () => {
  it("lee el ticket del ambiente", async () => {
    const { consultas, cliente } = supabaseFalso([
      { data: { ta_cifrado: "v1.a.b", ta_expira: "2026-10-16T20:00:00Z", ta_bloqueado_hasta: null }, error: null },
    ]);
    expect(await almacenTicket(cliente, "produccion").leer()).toEqual({
      taCifrado: "v1.a.b",
      taExpira: "2026-10-16T20:00:00Z",
      taBloqueadoHasta: null,
    });
    expect(consultas[0]).toContain('eq("ambiente","produccion")');
  });

  it("toma el bloqueo con un update condicional", async () => {
    const { consultas, cliente } = supabaseFalso([{ data: [{ ambiente: "homologacion" }], error: null }]);
    expect(await almacenTicket(cliente, "homologacion").tomarBloqueo(HASTA, AHORA)).toBe(true);
    expect(consultas[0]).toContain(
      'or("ta_bloqueado_hasta.is.null,ta_bloqueado_hasta.lt.2026-10-16T12:00:00.000Z")',
    );
  });

  it("informa que otro pedido tiene el bloqueo si está tomado y vigente", async () => {
    const { cliente } = supabaseFalso([
      { data: [], error: null },
      { data: { ta_cifrado: null, ta_expira: null, ta_bloqueado_hasta: "2026-10-16T12:00:30.000Z" }, error: null },
    ]);
    expect(await almacenTicket(cliente, "homologacion").tomarBloqueo(HASTA, AHORA)).toBe(false);
  });

  it("falla si el update no tocó filas y el bloqueo está libre", async () => {
    const { cliente } = supabaseFalso([
      { data: [], error: null },
      { data: { ta_cifrado: null, ta_expira: null, ta_bloqueado_hasta: null }, error: null },
    ]);
    await expect(almacenTicket(cliente, "homologacion").tomarBloqueo(HASTA, AHORA)).rejects.toThrow(
      "No se pudo reservar el pedido de ticket: no se actualizó ningún registro.",
    );
  });

  it("falla al guardar si no se actualizó ningún registro", async () => {
    const { cliente } = supabaseFalso([{ data: [], error: null }]);
    await expect(almacenTicket(cliente, "homologacion").guardar("v1.x.y", HASTA)).rejects.toThrow(
      "No se pudo guardar el ticket de acceso: no se actualizó ningún registro.",
    );
  });

  it("libera sólo el bloqueo que se tomó", async () => {
    const { consultas, cliente } = supabaseFalso([{ data: null, error: null }]);
    await almacenTicket(cliente, "homologacion").liberarBloqueo(HASTA);
    expect(consultas[0]).toContain('eq("ta_bloqueado_hasta","2026-10-16T12:01:00.000Z")');
  });
});
