import { describe, expect, it } from "vitest";
import { validarCuitConsulta, validarProveedorNuevo } from "./proveedores";

describe("validarCuitConsulta", () => {
  it("acepta 11 dígitos, con o sin guiones", () => {
    expect(validarCuitConsulta("30712345679")).toEqual({ cuit: "30712345679" });
    expect(validarCuitConsulta("30-71234567-9")).toEqual({ cuit: "30712345679" });
  });

  it("rechaza faltante o con otro largo", () => {
    expect(validarCuitConsulta(null)).toEqual({ error: "Indicá el CUIT (11 dígitos) en ?cuit=." });
    expect(validarCuitConsulta("")).toEqual({ error: "Indicá el CUIT (11 dígitos) en ?cuit=." });
    expect(validarCuitConsulta("3071234567")).toEqual({ error: "El CUIT tiene que tener 11 dígitos." });
  });
});

describe("validarProveedorNuevo", () => {
  const valido = {
    nombre: "  Sogas del Sur SA ",
    cuit: "30-71234567-9",
    condicion_iva: "Responsable Inscripto",
    domicilio: " Ruta 7 km 1000 ",
  };

  it("normaliza y devuelve las columnas de proveedor", () => {
    expect(validarProveedorNuevo(valido)).toEqual({
      datos: {
        nombre: "Sogas del Sur SA",
        cuit: "30712345679",
        condicion_iva: "Responsable Inscripto",
        domicilio: "Ruta 7 km 1000",
      },
    });
  });

  it("condición de IVA y domicilio son opcionales", () => {
    expect(validarProveedorNuevo({ nombre: "X", cuit: "30712345679" })).toEqual({
      datos: { nombre: "X", cuit: "30712345679", condicion_iva: null, domicilio: null },
    });
    expect(validarProveedorNuevo({ nombre: "X", cuit: "30712345679", condicion_iva: null, domicilio: "" })).toEqual({
      datos: { nombre: "X", cuit: "30712345679", condicion_iva: null, domicilio: null },
    });
  });

  it("junta todos los errores", () => {
    expect(validarProveedorNuevo({ nombre: " ", cuit: "123", condicion_iva: "Inscripto", domicilio: 5 })).toEqual({
      errores: [
        "nombre: es obligatorio.",
        "cuit: El CUIT tiene que tener 11 dígitos.",
        "condicion_iva: tiene que ser Responsable Inscripto, Monotributista, Exento o Consumidor Final.",
        "domicilio: tiene que ser texto.",
      ],
    });
  });

  it("el CUIT es obligatorio", () => {
    expect(validarProveedorNuevo({ nombre: "X" })).toEqual({ errores: ["cuit: es obligatorio."] });
  });

  it("rechaza lo que no es un objeto", () => {
    expect(validarProveedorNuevo([])).toEqual({ errores: ["El cuerpo tiene que ser un objeto JSON."] });
    expect(validarProveedorNuevo(null)).toEqual({ errores: ["El cuerpo tiene que ser un objeto JSON."] });
  });
});
