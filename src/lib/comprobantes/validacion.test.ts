import { describe, expect, it } from "vitest";
import { validarParaAutorizar, type BorradorAValidar } from "./validacion";

const HOY = "2026-10-16";

const valido: BorradorAValidar = {
  clase: "factura",
  fecha: HOY,
  receptor: { razonSocial: "Frutícola S.A.", condicionIva: "Responsable Inscripto", cuit: "20111111112" },
  items: [{ cantidad: 2, precioUnitario: 100, descuentoPct: 0, alicuotaIva: 21 }],
};

describe("validarParaAutorizar", () => {
  it("no informa errores en un borrador completo", () => {
    expect(validarParaAutorizar(valido, HOY)).toEqual([]);
  });

  it("pide la razón social y la condición IVA del cliente", () => {
    const errores = validarParaAutorizar(
      { ...valido, receptor: { razonSocial: " ", condicionIva: null, cuit: null } },
      HOY,
    );
    expect(errores).toEqual([
      "Falta la razón social del cliente.",
      "Completá la condición frente al IVA del cliente.",
    ]);
  });

  it("exige una CUIT válida para letra A", () => {
    const errores = validarParaAutorizar({ ...valido, receptor: { ...valido.receptor, cuit: "20111111113" } }, HOY);
    expect(errores).toEqual(["Para un comprobante A el cliente necesita una CUIT válida."]);
  });

  it("no exige CUIT para letra B", () => {
    const receptor = { razonSocial: "Juan Pérez", condicionIva: "Consumidor Final" as const, cuit: null };
    expect(validarParaAutorizar({ ...valido, receptor }, HOY)).toEqual([]);
  });

  it("pide al menos un ítem", () => {
    expect(validarParaAutorizar({ ...valido, items: [] }, HOY)).toEqual([
      "Agregá al menos un ítem.",
      "El total tiene que ser mayor a cero.",
    ]);
  });

  it("exige cantidades mayores a cero, indicando el renglón", () => {
    const items = [valido.items[0], { cantidad: 0, precioUnitario: 10, descuentoPct: 0, alicuotaIva: 21 }];
    expect(validarParaAutorizar({ ...valido, items }, HOY)).toEqual([
      "La cantidad del ítem 2 tiene que ser mayor a cero.",
    ]);
  });

  it("exige un total mayor a cero", () => {
    const items = [{ cantidad: 1, precioUnitario: 0, descuentoPct: 0, alicuotaIva: 21 }];
    expect(validarParaAutorizar({ ...valido, items }, HOY)).toEqual(["El total tiene que ser mayor a cero."]);
  });

  it("acepta un comprobante con sólo ítems no gravados", () => {
    const items = [{ cantidad: 1, precioUnitario: 150000, descuentoPct: 0, alicuotaIva: "no_gravado" as const }];
    expect(validarParaAutorizar({ ...valido, clase: "nota_debito", items }, HOY)).toEqual([]);
  });

  it("acepta fechas hasta 5 días antes o después de hoy", () => {
    expect(validarParaAutorizar({ ...valido, fecha: "2026-10-11" }, HOY)).toEqual([]);
    expect(validarParaAutorizar({ ...valido, fecha: "2026-10-21" }, HOY)).toEqual([]);
  });

  it("rechaza fechas a más de 5 días de hoy", () => {
    const mensaje = "La fecha del comprobante tiene que estar entre el 11/10/2026 y el 21/10/2026.";
    expect(validarParaAutorizar({ ...valido, fecha: "2026-10-10" }, HOY)).toEqual([mensaje]);
    expect(validarParaAutorizar({ ...valido, fecha: "2026-10-22" }, HOY)).toEqual([mensaje]);
  });

  it("cruza bien los cambios de mes y año", () => {
    expect(validarParaAutorizar({ ...valido, fecha: "2026-12-29" }, "2027-01-02")).toEqual([]);
  });

  it("informa una fecha vacía o mal formada en lugar de aceptarla", () => {
    const mensaje = "La fecha del comprobante no es válida.";
    for (const fecha of ["", "16/10/2026", "2026-10", "2026-02-30", "2026-13-01", "abc"]) {
      expect(validarParaAutorizar({ ...valido, fecha }, HOY)).toEqual([mensaje]);
    }
  });

  it("informa si no se pudo determinar la fecha de hoy", () => {
    expect(validarParaAutorizar(valido, "")).toEqual(["No se pudo determinar la fecha de hoy para validar la fecha."]);
  });
});
