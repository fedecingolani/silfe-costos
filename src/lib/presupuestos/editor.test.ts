import { describe, expect, it } from "vitest";
import { cabeceraDuplicada, validezAlCambiarFecha } from "./editor";

describe("validezAlCambiarFecha", () => {
  it("si «válido hasta» era el de por defecto, lo corre con la fecha", () => {
    expect(validezAlCambiarFecha("2026-10-16", "2026-10-20", "2026-10-31")).toBe("2026-11-04");
  });

  it("si estaba vacío, propone el de por defecto de la fecha nueva", () => {
    expect(validezAlCambiarFecha("2026-10-16", "2026-10-20", "")).toBe("2026-11-04");
  });

  it("respeta un «válido hasta» elegido a mano que sigue siendo posterior", () => {
    expect(validezAlCambiarFecha("2026-10-16", "2026-10-20", "2026-12-01")).toBe("2026-12-01");
  });

  it("si la fecha nueva pasa un «válido hasta» elegido a mano, propone el de por defecto", () => {
    expect(validezAlCambiarFecha("2026-10-16", "2026-12-10", "2026-12-01")).toBe("2026-12-25");
  });

  it("con una fecha nueva inválida (campo a medio cargar) no lo toca", () => {
    expect(validezAlCambiarFecha("2026-10-16", "", "2026-10-31")).toBe("2026-10-31");
  });
});

describe("cabeceraDuplicada", () => {
  const origen = {
    cliente_id: "c0000000-0000-0000-0000-000000000001",
    fecha: "2026-09-01",
    valido_hasta: "2026-09-16",
    fecha_vencimiento_pago: "2026-11-30",
    condicion_pago: "cuenta_corriente" as const,
    lista_precio_id: "a0000000-0000-0000-0000-000000000001",
    observaciones: "Entrega en planta",
    neto: 1000,
    no_gravado: 50,
    iva: 210,
    total: 1260,
  };

  it("copia cliente, lista, condición, observaciones y totales con fecha de hoy y validez por defecto", () => {
    expect(cabeceraDuplicada(origen, "2026-10-24")).toEqual({
      ...origen,
      fecha: "2026-10-24",
      valido_hasta: "2026-11-08",
      fecha_vencimiento_pago: "2026-11-30",
    });
  });

  it("si el vencimiento del cobro quedó antes de hoy, pasa a hoy", () => {
    expect(cabeceraDuplicada({ ...origen, fecha_vencimiento_pago: "2026-09-10" }, "2026-10-24").fecha_vencimiento_pago).toBe(
      "2026-10-24",
    );
  });

  it("de contado vence en la fecha", () => {
    expect(cabeceraDuplicada({ ...origen, condicion_pago: "contado" }, "2026-10-24").fecha_vencimiento_pago).toBe("2026-10-24");
  });

  it("convierte los importes que llegan como texto de Postgres", () => {
    const duplicada = cabeceraDuplicada(
      { ...origen, neto: "1000.00", no_gravado: "0", iva: "210.00", total: "1210.00", observaciones: null },
      "2026-10-24",
    );
    expect(duplicada).toMatchObject({ neto: 1000, no_gravado: 0, iva: 210, total: 1210, observaciones: null });
  });
});
