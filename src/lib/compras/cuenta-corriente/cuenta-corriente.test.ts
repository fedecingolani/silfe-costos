import { describe, expect, it } from "vitest";
import {
  estadoSaldoProveedor,
  filtroBusquedaProveedores,
  importeAAplicar,
  ordenarCuentasProveedor,
  resumenAplicacion,
  totalesCuentasProveedor,
  type FilaCuentaProveedor,
} from "./cuenta-corriente";

function fila(cambios: Partial<FilaCuentaProveedor>): FilaCuentaProveedor {
  return {
    proveedorId: "p",
    nombre: "Proveedor",
    saldo: 0,
    deudaPendiente: 0,
    saldoAFavor: 0,
    pendienteMasViejo: null,
    pendientes: 0,
    ...cambios,
  };
}

describe("estadoSaldoProveedor", () => {
  it("un saldo positivo es lo que le debemos", () => {
    expect(estadoSaldoProveedor(10)).toEqual({ texto: "Le debemos", tono: "rojo" });
  });
  it("un saldo negativo es a favor nuestro", () => {
    expect(estadoSaldoProveedor(-0.01)).toEqual({ texto: "A favor", tono: "azul" });
  });
  it("menos de un centavo es sin saldo", () => {
    expect(estadoSaldoProveedor(0.001)).toEqual({ texto: "Sin saldo", tono: "neutro" });
  });
});

describe("ordenarCuentasProveedor", () => {
  const a = fila({ proveedorId: "a", nombre: "Andinas", saldo: 100, pendienteMasViejo: "2026-10-05" });
  const b = fila({ proveedorId: "b", nombre: "Bolsas", saldo: 500, pendienteMasViejo: "2026-11-01" });
  const c = fila({ proveedorId: "c", nombre: "Cintas", saldo: -50 });
  const d = fila({ proveedorId: "d", nombre: "Ábaco", saldo: 100, pendienteMasViejo: "2026-10-05" });

  it("por saldo: de mayor a menor, empates por nombre", () => {
    expect(ordenarCuentasProveedor([c, a, b, d], "saldo").map((f) => f.proveedorId)).toEqual(["b", "d", "a", "c"]);
  });
  it("por antigüedad: la deuda más vieja primero y los que no deben al final", () => {
    expect(ordenarCuentasProveedor([c, b, a, d], "antiguedad").map((f) => f.proveedorId)).toEqual(["d", "a", "b", "c"]);
  });
  it("no modifica la lista recibida", () => {
    const lista = [c, a];
    ordenarCuentasProveedor(lista, "saldo");
    expect(lista).toEqual([c, a]);
  });
});

describe("totalesCuentasProveedor", () => {
  it("suma la deuda pendiente y el saldo a favor sin errores de redondeo", () => {
    const filas = [fila({ deudaPendiente: 0.1, saldoAFavor: 0.2 }), fila({ deudaPendiente: 0.2, saldoAFavor: 0.1 })];
    expect(totalesCuentasProveedor(filas)).toEqual({ adeudado: 0.3, aFavor: 0.3 });
  });
});

describe("filtroBusquedaProveedores", () => {
  it("sin texto no filtra", () => {
    expect(filtroBusquedaProveedores("  ")).toBeNull();
    expect(filtroBusquedaProveedores(undefined)).toBeNull();
  });
  it("busca en el nombre y el CUIT", () => {
    expect(filtroBusquedaProveedores("sogas")).toBe('nombre.ilike."%sogas%",cuit.ilike."%sogas%"');
  });
  it("escapa comodines, comillas y descarta el asterisco", () => {
    expect(filtroBusquedaProveedores('10%_"a*')).toBe(
      'nombre.ilike."%10\\\\%\\\\_\\"a%",cuit.ilike."%10\\\\%\\\\_\\"a%"',
    );
  });
});

describe("importeAAplicar", () => {
  it("es el saldo del débito si alcanza lo que hay a favor", () => {
    expect(importeAAplicar(1754.5, 2420)).toBe(1754.5);
  });
  it("es lo que hay a favor si no alcanza", () => {
    expect(importeAAplicar(12400, 2420)).toBe(2420);
  });
  it("es cero sin saldo o sin nada a favor", () => {
    expect(importeAAplicar(0, 100)).toBe(0);
    expect(importeAAplicar(100, 0)).toBe(0);
    expect(importeAAplicar(-5, 100)).toBe(0);
  });
});

describe("resumenAplicacion", () => {
  it("dice cuánto se aplica y cuánto queda pendiente", () => {
    expect(resumenAplicacion("FC A 00003-00012345", 12400, 2420)).toBe(
      "Se van a aplicar $ 2.420,00 del saldo a favor a FC A 00003-00012345. Quedan $ 9.980,00 pendientes.",
    );
  });
  it("avisa cuando el comprobante queda cancelado", () => {
    expect(resumenAplicacion("FC A 00003-00012400", 1754.5, 2420)).toBe(
      "Se van a aplicar $ 1.754,50 del saldo a favor a FC A 00003-00012400. Queda cancelado.",
    );
  });
});
