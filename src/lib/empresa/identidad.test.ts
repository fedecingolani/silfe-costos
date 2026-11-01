import { describe, expect, it } from "vitest";
import { estiloMarca, nombreVisible, urlLogo } from "./identidad";

describe("nombreVisible", () => {
  it("usa el nombre de fantasía si está cargado", () => {
    expect(nombreVisible("Empresa de Ejemplo", "EMPRESA DE EJEMPLO S.A.")).toBe("Empresa de Ejemplo");
  });

  it("si no, usa la razón social de ARCA", () => {
    expect(nombreVisible(null, "EMPRESA DE EJEMPLO S.A.")).toBe("EMPRESA DE EJEMPLO S.A.");
    expect(nombreVisible("  ", "EMPRESA DE EJEMPLO S.A.")).toBe("EMPRESA DE EJEMPLO S.A.");
  });

  it("sin ninguno de los dos, no hay nombre", () => {
    expect(nombreVisible(null, null)).toBeNull();
    expect(nombreVisible("", " ")).toBeNull();
  });
});

describe("estiloMarca", () => {
  it("define --marca-base con un color válido", () => {
    expect(estiloMarca("#1a2b3c")).toEqual({ "--marca-base": "#1a2b3c" });
  });

  it("no define nada sin color o con un valor que no es #rrggbb", () => {
    expect(estiloMarca(null)).toBeUndefined();
    expect(estiloMarca("red")).toBeUndefined();
    expect(estiloMarca("#000; background: url(x)")).toBeUndefined();
  });
});

describe("urlLogo", () => {
  it("versiona la URL con la fecha de actualización", () => {
    expect(urlLogo("2026-11-01T12:00:00+00:00")).toBe("/empresa/logo?v=2026-11-01T12%3A00%3A00%2B00%3A00");
  });
});
