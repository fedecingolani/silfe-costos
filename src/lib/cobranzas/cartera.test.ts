import { describe, expect, it } from "vitest";
import {
  accionesDisponibles,
  estadoChequeVisible,
  filtrarPorEstado,
  leerFiltrosCartera,
  totalesPorEstado,
  validarCambioCheque,
} from "./cartera";
import { mensajeErrorCobranza } from "./errores";

describe("filtros de la cartera", () => {
  it("por defecto muestra los cheques en cartera", () => {
    expect(leerFiltrosCartera({})).toEqual({ estado: "en_cartera", desde: "", hasta: "", cliente: "" });
  });

  it("lee estado, fechas de pago y cliente; ignora valores desconocidos", () => {
    expect(
      leerFiltrosCartera({ estado: "rechazado", desde: "2026-11-01", hasta: "x", cliente: [" acme ", "otro"] }),
    ).toEqual({ estado: "rechazado", desde: "2026-11-01", hasta: "", cliente: "acme" });
    expect(leerFiltrosCartera({ estado: "todos" }).estado).toBe("todos");
    expect(leerFiltrosCartera({ estado: "anulado" }).estado).toBe("en_cartera");
  });

  it("filtra por estado", () => {
    const filas = [
      { id: "1", estado: "en_cartera" as const },
      { id: "2", estado: "rechazado" as const },
    ];
    expect(filtrarPorEstado(filas, "rechazado").map((f) => f.id)).toEqual(["2"]);
    expect(filtrarPorEstado(filas, "todos").map((f) => f.id)).toEqual(["1", "2"]);
  });
});

describe("totales por estado", () => {
  it("cuenta cheques y suma importes exactos a centavos", () => {
    expect(
      totalesPorEstado([
        { estado: "en_cartera", importe: 0.1 },
        { estado: "en_cartera", importe: 0.2 },
        { estado: "rechazado", importe: 100 },
        { estado: "anulado", importe: 999 },
      ]),
    ).toEqual({
      en_cartera: { cantidad: 2, importe: 0.3 },
      depositado: { cantidad: 0, importe: 0 },
      entregado: { cantidad: 0, importe: 0 },
      rechazado: { cantidad: 1, importe: 100 },
    });
  });
});

describe("acciones por estado", () => {
  it("son las transiciones de la cartera", () => {
    expect(accionesDisponibles("en_cartera")).toEqual(["depositar", "entregar", "rechazar"]);
    expect(accionesDisponibles("depositado")).toEqual(["rechazar"]);
    expect(accionesDisponibles("entregado")).toEqual(["rechazar"]);
    expect(accionesDisponibles("rechazado")).toEqual([]);
    expect(accionesDisponibles("anulado")).toEqual([]);
  });
});

describe("estado visible", () => {
  it("un rechazado con la ND en borrador está pendiente", () => {
    expect(estadoChequeVisible({ estado: "rechazado", nd_estado: "borrador", nd_numero_texto: null })).toEqual({
      texto: "Rechazado – ND pendiente",
      tono: "rojo",
      nd: "ND pendiente",
    });
  });

  it("un rechazado con la ND autorizada muestra su número", () => {
    expect(
      estadoChequeVisible({ estado: "rechazado", nd_estado: "autorizado", nd_numero_texto: "A-00007-00000012" }),
    ).toEqual({ texto: "Rechazado", tono: "rojo", nd: "ND A-00007-00000012" });
  });

  it("los demás estados no tienen ND", () => {
    expect(estadoChequeVisible({ estado: "en_cartera", nd_estado: null, nd_numero_texto: null })).toEqual({
      texto: "En cartera",
      tono: "azul",
      nd: null,
    });
    expect(estadoChequeVisible({ estado: "depositado", nd_estado: null, nd_numero_texto: null }).tono).toBe("verde");
  });
});

describe("validarCambioCheque", () => {
  const hoy = "2026-11-20";

  it("depositar pide una fecha válida y normaliza la observación", () => {
    expect(validarCambioCheque("en_cartera", { accion: "depositar", fecha: hoy, observacion: "  Banco  " })).toEqual({
      cambio: { accion: "depositar", fecha: hoy, observacion: "Banco", entregadoA: null, gastos: null },
    });
    expect(validarCambioCheque("en_cartera", { accion: "depositar", fecha: "" })).toEqual({
      errores: ["Completá la fecha."],
    });
  });

  it("entregar exige a quién", () => {
    expect(validarCambioCheque("en_cartera", { accion: "entregar", fecha: hoy, entregadoA: " " })).toEqual({
      errores: ["Completá a quién se entregó el cheque."],
    });
    expect(validarCambioCheque("en_cartera", { accion: "entregar", fecha: hoy, entregadoA: " Proveedor SA " })).toEqual({
      cambio: { accion: "entregar", fecha: hoy, observacion: null, entregadoA: "Proveedor SA", gastos: null },
    });
  });

  it("rechazar admite gastos bancarios opcionales con descripción", () => {
    expect(validarCambioCheque("depositado", { accion: "rechazar", fecha: hoy, gastosImporte: 0 })).toEqual({
      cambio: { accion: "rechazar", fecha: hoy, observacion: null, entregadoA: null, gastos: null },
    });
    expect(
      validarCambioCheque("depositado", {
        accion: "rechazar",
        fecha: hoy,
        gastosImporte: 1500.5,
        gastosDescripcion: " Comisión ",
      }),
    ).toEqual({
      cambio: {
        accion: "rechazar",
        fecha: hoy,
        observacion: null,
        entregadoA: null,
        gastos: { importe: 1500.5, descripcion: "Comisión" },
      },
    });
    expect(validarCambioCheque("en_cartera", { accion: "rechazar", fecha: hoy, gastosImporte: 10 })).toEqual({
      errores: ["Completá la descripción de los gastos bancarios."],
    });
    expect(validarCambioCheque("en_cartera", { accion: "rechazar", fecha: hoy, gastosImporte: -1 })).toEqual({
      errores: ["Los gastos bancarios no pueden ser negativos."],
    });
    expect(validarCambioCheque("en_cartera", { accion: "rechazar", fecha: hoy, gastosImporte: 1.234, gastosDescripcion: "x" })).toEqual({
      errores: ["Los gastos bancarios van con hasta 2 decimales."],
    });
  });

  it("no permite acciones fuera de las transiciones", () => {
    expect(validarCambioCheque("depositado", { accion: "entregar", fecha: hoy, entregadoA: "X" })).toEqual({
      errores: ["Un cheque depositado no se puede entregar."],
    });
    expect(validarCambioCheque("rechazado", { accion: "rechazar", fecha: hoy })).toEqual({
      errores: ["Un cheque rechazado no se puede rechazar."],
    });
  });
});

describe("errores de la cartera", () => {
  it("muestra los mensajes de la base del rechazo y la ND", () => {
    expect(mensajeErrorCobranza({ code: "CB020", message: "Es la nota de débito del cheque…" })).toBe(
      "Es la nota de débito del cheque…",
    );
    expect(mensajeErrorCobranza({ code: "CB022", message: "Completá la descripción de los gastos bancarios." })).toBe(
      "Completá la descripción de los gastos bancarios.",
    );
    expect(mensajeErrorCobranza({ code: "CB021", message: "x" }, "rechazar el cheque")).toBe(
      "No se encontró el cheque. Recargá la página.",
    );
  });
});
