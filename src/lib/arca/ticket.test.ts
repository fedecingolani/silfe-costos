import { describe, expect, it } from "vitest";
import { BLOQUEO_TICKET_MS, MARGEN_TICKET_MS, decidirTicket } from "./ticket";

const AHORA = new Date("2026-10-15T12:00:00Z");
const en = (ms: number) => new Date(AHORA.getTime() + ms);

describe("decidirTicket", () => {
  it("pide un ticket si nunca se pidió", () => {
    expect(decidirTicket({ taExpira: null, taBloqueadoHasta: null }, AHORA)).toBe("solicitar");
  });

  it("reutiliza un ticket que vence en más de 5 minutos", () => {
    expect(decidirTicket({ taExpira: en(6 * 60_000), taBloqueadoHasta: null }, AHORA)).toBe("reutilizar");
  });

  it("pide uno nuevo si vence en 5 minutos o menos", () => {
    expect(decidirTicket({ taExpira: en(MARGEN_TICKET_MS), taBloqueadoHasta: null }, AHORA)).toBe("solicitar");
    expect(decidirTicket({ taExpira: en(-1), taBloqueadoHasta: null }, AHORA)).toBe("solicitar");
  });

  it("espera si otro pedido tiene el bloqueo vigente", () => {
    expect(decidirTicket({ taExpira: null, taBloqueadoHasta: en(30_000) }, AHORA)).toBe("esperar");
  });

  it("pide uno nuevo si el bloqueo ya venció", () => {
    expect(decidirTicket({ taExpira: null, taBloqueadoHasta: en(-1) }, AHORA)).toBe("solicitar");
  });

  it("reutiliza un ticket vigente aunque haya un bloqueo", () => {
    expect(decidirTicket({ taExpira: en(60 * 60_000), taBloqueadoHasta: en(30_000) }, AHORA)).toBe("reutilizar");
  });

  it("acepta fechas como texto ISO (como vienen de la base)", () => {
    expect(
      decidirTicket({ taExpira: en(60 * 60_000).toISOString(), taBloqueadoHasta: null }, AHORA),
    ).toBe("reutilizar");
  });

  it("bloquea durante un minuto", () => {
    expect(BLOQUEO_TICKET_MS).toBe(60_000);
  });
});
