import { describe, expect, it } from "vitest";
import {
  ESTADOS_SEGUIMIENTO,
  estadoSeguimiento,
  fechaLocalAIso,
  fechaLocalArgentina,
  filtroSeguimiento,
  hoyArgentina,
  rutaDeVuelta,
  sumarDias,
  truncar,
} from "./seguimiento";

describe("hoyArgentina", () => {
  it("devuelve la fecha de Argentina, no la de UTC", () => {
    // 01:30 UTC del 15 es todavía 22:30 del 14 en Argentina (UTC-3).
    expect(hoyArgentina(new Date("2026-10-15T01:30:00Z"))).toBe("2026-10-14");
    expect(hoyArgentina(new Date("2026-10-15T03:00:00Z"))).toBe("2026-10-15");
  });

  it("rellena mes y día con ceros", () => {
    expect(hoyArgentina(new Date("2026-01-05T15:00:00Z"))).toBe("2026-01-05");
  });
});

describe("sumarDias", () => {
  it("suma y resta días cruzando meses y años", () => {
    expect(sumarDias("2026-10-14", 1)).toBe("2026-10-15");
    expect(sumarDias("2026-10-31", 1)).toBe("2026-11-01");
    expect(sumarDias("2026-12-31", 1)).toBe("2027-01-01");
    expect(sumarDias("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("estadoSeguimiento", () => {
  const hoy = "2026-10-14";

  it("sin fecha es sin agenda", () => {
    expect(estadoSeguimiento(null, hoy)).toBe("sin_agenda");
    expect(estadoSeguimiento("", hoy)).toBe("sin_agenda");
  });

  it("antes de hoy está atrasado", () => {
    expect(estadoSeguimiento("2026-10-13", hoy)).toBe("atrasado");
    expect(estadoSeguimiento("2025-12-31", hoy)).toBe("atrasado");
  });

  it("hoy es hoy", () => {
    expect(estadoSeguimiento("2026-10-14", hoy)).toBe("hoy");
  });

  it("de 1 a 7 días es próximo, y desde el octavo más adelante", () => {
    expect(estadoSeguimiento("2026-10-15", hoy)).toBe("proximo");
    expect(estadoSeguimiento("2026-10-21", hoy)).toBe("proximo");
    expect(estadoSeguimiento("2026-10-22", hoy)).toBe("mas_adelante");
  });

  it("cuenta los días cruzando el fin de mes", () => {
    expect(estadoSeguimiento("2026-11-03", "2026-10-27")).toBe("proximo");
    expect(estadoSeguimiento("2026-11-04", "2026-10-27")).toBe("mas_adelante");
  });
});

describe("ESTADOS_SEGUIMIENTO", () => {
  it("tiene etiqueta y tono para cada estado", () => {
    expect(ESTADOS_SEGUIMIENTO.atrasado).toEqual({ etiqueta: "Atrasado", tono: "rojo" });
    expect(ESTADOS_SEGUIMIENTO.hoy).toEqual({ etiqueta: "Hoy", tono: "ambar" });
    expect(ESTADOS_SEGUIMIENTO.proximo.etiqueta).toBe("Próximo");
    expect(ESTADOS_SEGUIMIENTO.mas_adelante.etiqueta).toBe("Más adelante");
    expect(ESTADOS_SEGUIMIENTO.sin_agenda.etiqueta).toBe("Sin agenda");
  });
});

describe("filtroSeguimiento", () => {
  it("por defecto no filtra", () => {
    expect(filtroSeguimiento(undefined)).toEqual({ valor: "todos", estado: null });
    expect(filtroSeguimiento("cualquiera")).toEqual({ valor: "todos", estado: null });
  });

  it("traduce el parámetro de la URL al estado de la vista", () => {
    expect(filtroSeguimiento("atrasados")).toEqual({ valor: "atrasados", estado: "atrasado" });
    expect(filtroSeguimiento("hoy")).toEqual({ valor: "hoy", estado: "hoy" });
    expect(filtroSeguimiento("proximos")).toEqual({ valor: "proximos", estado: "proximo" });
    expect(filtroSeguimiento("sin-agenda")).toEqual({ valor: "sin-agenda", estado: "sin_agenda" });
  });
});

describe("fechaLocalArgentina", () => {
  it("convierte una marca de tiempo al valor de un input datetime-local en hora argentina", () => {
    expect(fechaLocalArgentina("2026-10-14T13:05:00Z")).toBe("2026-10-14T10:05");
    expect(fechaLocalArgentina(new Date("2026-10-15T01:30:00Z"))).toBe("2026-10-14T22:30");
  });

  it("usa 00 para la medianoche", () => {
    expect(fechaLocalArgentina("2026-10-14T03:00:00Z")).toBe("2026-10-14T00:00");
  });
});

describe("fechaLocalAIso", () => {
  it("interpreta el valor del formulario como hora argentina", () => {
    expect(fechaLocalAIso("2026-10-14T10:05")).toBe("2026-10-14T10:05:00-03:00");
    expect(new Date(fechaLocalAIso("2026-10-14T22:30")!).toISOString()).toBe("2026-10-15T01:30:00.000Z");
  });

  it("acepta segundos", () => {
    expect(fechaLocalAIso("2026-10-14T10:05:30")).toBe("2026-10-14T10:05:30-03:00");
  });

  it("devuelve null si está vacío o no tiene el formato", () => {
    expect(fechaLocalAIso("")).toBeNull();
    expect(fechaLocalAIso(null)).toBeNull();
    expect(fechaLocalAIso("14/10/2026 10:05")).toBeNull();
    expect(fechaLocalAIso("2026-13-40T10:05")).toBeNull();
  });
});

describe("rutaDeVuelta", () => {
  const cliente = "11111111-1111-1111-1111-111111111111";

  it("por defecto vuelve a la ficha del cliente", () => {
    expect(rutaDeVuelta(null, cliente)).toBe(`/clientes/${cliente}`);
    expect(rutaDeVuelta("", cliente)).toBe(`/clientes/${cliente}`);
  });

  it("acepta volver a la pantalla de seguimiento, con su filtro", () => {
    expect(rutaDeVuelta("/seguimiento", cliente)).toBe("/seguimiento");
    expect(rutaDeVuelta("/seguimiento?zona=abc-123", cliente)).toBe("/seguimiento?zona=abc-123");
  });

  it("no acepta otras rutas ni sitios externos", () => {
    expect(rutaDeVuelta("https://malo.com", cliente)).toBe(`/clientes/${cliente}`);
    expect(rutaDeVuelta("//malo.com/seguimiento", cliente)).toBe(`/clientes/${cliente}`);
    expect(rutaDeVuelta("/seguimiento/../productos", cliente)).toBe(`/clientes/${cliente}`);
    expect(rutaDeVuelta("/productos", cliente)).toBe(`/clientes/${cliente}`);
  });
});

describe("truncar", () => {
  it("deja igual un texto corto", () => {
    expect(truncar("Hola", 10)).toBe("Hola");
  });

  it("corta un texto largo con puntos suspensivos", () => {
    expect(truncar("Pidió presupuesto de lonas", 10)).toBe("Pidió pre…");
  });

  it("devuelve null si no hay texto", () => {
    expect(truncar(null, 10)).toBeNull();
  });
});
