import { describe, expect, it } from "vitest";
import { estadoVencimiento } from "./vencimiento";

const AHORA = new Date("2026-10-15T12:00:00Z");
const enDias = (dias: number) => new Date(AHORA.getTime() + dias * 24 * 60 * 60_000).toISOString();

describe("estadoVencimiento", () => {
  it("está vigente si vence en más de 30 días", () => {
    expect(estadoVencimiento(enDias(31), AHORA)).toBe("vigente");
  });

  it("avisa si vence dentro de 30 días", () => {
    expect(estadoVencimiento(enDias(30), AHORA)).toBe("por-vencer");
    expect(estadoVencimiento(enDias(1), AHORA)).toBe("por-vencer");
  });

  it("marca vencido el certificado que ya venció", () => {
    expect(estadoVencimiento(enDias(0), AHORA)).toBe("vencido");
    expect(estadoVencimiento(enDias(-3), AHORA)).toBe("vencido");
  });
});
