import { describe, expect, it } from "vitest";
import {
  diasDeAntiguedad,
  estadoSaldo,
  leerFiltrosCuentas,
  ordenarCuentas,
  rangoMovimientos,
  totalesCuentas,
  type FilaCuenta,
} from "./cuenta-corriente";

function fila(cambios: Partial<FilaCuenta>): FilaCuenta {
  return {
    clienteId: "x",
    razonSocial: "X",
    saldo: 0,
    deudaPendiente: 0,
    saldoAFavor: 0,
    pendienteMasViejo: null,
    pendientes: 0,
    ...cambios,
  };
}

describe("diasDeAntiguedad", () => {
  it("cuenta los días corridos hasta hoy", () => {
    expect(diasDeAntiguedad("2026-10-18", "2026-10-18")).toBe(0);
    expect(diasDeAntiguedad("2026-10-08", "2026-10-18")).toBe(10);
    expect(diasDeAntiguedad("2025-10-18", "2026-10-18")).toBe(365);
  });

  it("cruza meses y años bisiestos sin errores de horario", () => {
    expect(diasDeAntiguedad("2028-02-28", "2028-03-01")).toBe(2);
    expect(diasDeAntiguedad("2026-03-28", "2026-03-30")).toBe(2);
  });

  it("una fecha futura no tiene antigüedad", () => {
    expect(diasDeAntiguedad("2026-10-20", "2026-10-18")).toBe(0);
  });
});

describe("rangoMovimientos", () => {
  it("por defecto toma los últimos 12 meses hasta hoy", () => {
    expect(rangoMovimientos({}, "2026-10-18")).toEqual({ desde: "2025-10-18", hasta: "2026-10-18" });
  });

  it("el 29 de febrero retrocede al 1 de marzo del año anterior", () => {
    expect(rangoMovimientos({}, "2028-02-29")).toEqual({ desde: "2027-03-01", hasta: "2028-02-29" });
  });

  it("respeta las fechas válidas que llegan por la URL", () => {
    expect(rangoMovimientos({ desde: "2026-01-01", hasta: "2026-06-30" }, "2026-10-18")).toEqual({
      desde: "2026-01-01",
      hasta: "2026-06-30",
    });
  });

  it("ignora fechas inválidas y da vuelta un rango al revés", () => {
    expect(rangoMovimientos({ desde: "2026-13-01", hasta: "x" }, "2026-10-18")).toEqual({
      desde: "2025-10-18",
      hasta: "2026-10-18",
    });
    expect(rangoMovimientos({ desde: "2026-06-30", hasta: "2026-01-01" }, "2026-10-18")).toEqual({
      desde: "2026-01-01",
      hasta: "2026-06-30",
    });
  });

  it("toma el primer valor si el parámetro viene repetido", () => {
    expect(rangoMovimientos({ desde: ["2026-02-01", "2026-03-01"] }, "2026-10-18").desde).toBe("2026-02-01");
  });
});

describe("leerFiltrosCuentas", () => {
  it("ordena por saldo salvo que pidan antigüedad", () => {
    expect(leerFiltrosCuentas({})).toEqual({ orden: "saldo", texto: "" });
    expect(leerFiltrosCuentas({ orden: "antiguedad", q: "  acme " })).toEqual({ orden: "antiguedad", texto: "acme" });
    expect(leerFiltrosCuentas({ orden: "cualquiera" }).orden).toBe("saldo");
  });
});

describe("ordenarCuentas", () => {
  const a = fila({ clienteId: "a", razonSocial: "Alfa", saldo: 100, pendienteMasViejo: "2026-09-01" });
  const b = fila({ clienteId: "b", razonSocial: "Beta", saldo: 500, pendienteMasViejo: "2026-10-01" });
  const c = fila({ clienteId: "c", razonSocial: "Gama", saldo: -50, saldoAFavor: 50 });
  const d = fila({ clienteId: "d", razonSocial: "Delta", saldo: 100, pendienteMasViejo: "2026-01-01" });

  it("por saldo: de mayor a menor, y a igual saldo por razón social", () => {
    expect(ordenarCuentas([a, c, b, d], "saldo").map((f) => f.clienteId)).toEqual(["b", "a", "d", "c"]);
  });

  it("por antigüedad: la deuda más vieja primero y los que no deben al final", () => {
    expect(ordenarCuentas([a, c, b, d], "antiguedad").map((f) => f.clienteId)).toEqual(["d", "a", "b", "c"]);
  });

  it("no modifica la lista original", () => {
    const lista = [a, b];
    ordenarCuentas(lista, "saldo");
    expect(lista.map((f) => f.clienteId)).toEqual(["a", "b"]);
  });
});

describe("totalesCuentas", () => {
  it("suma lo adeudado (pendientes) y lo que está a favor, exacto a centavos", () => {
    expect(
      totalesCuentas([
        fila({ deudaPendiente: 0.1, saldoAFavor: 0 }),
        fila({ deudaPendiente: 0.2, saldoAFavor: 10.05 }),
        fila({ deudaPendiente: 0, saldoAFavor: 0.3 }),
      ]),
    ).toEqual({ adeudado: 0.3, aFavor: 10.35 });
  });

  it("sin filas, todo en cero", () => {
    expect(totalesCuentas([])).toEqual({ adeudado: 0, aFavor: 0 });
  });
});

describe("estadoSaldo", () => {
  it("dice si el cliente debe, tiene a favor o está al día", () => {
    expect(estadoSaldo(10)).toEqual({ texto: "Deudor", tono: "rojo" });
    expect(estadoSaldo(-10)).toEqual({ texto: "A favor", tono: "azul" });
    expect(estadoSaldo(0)).toEqual({ texto: "Sin saldo", tono: "neutro" });
    expect(estadoSaldo(0.001)).toEqual({ texto: "Sin saldo", tono: "neutro" });
  });
});
