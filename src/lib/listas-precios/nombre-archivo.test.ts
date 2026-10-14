import { describe, expect, it } from "vitest";
import { dispositionAdjunto, slugArchivo } from "./nombre-archivo";

describe("slugArchivo", () => {
  it("pasa a ASCII, minúsculas y guiones", () => {
    expect(slugArchivo("Lista Diciembre 2023 – Mayoristas")).toBe("lista-diciembre-2023-mayoristas");
    expect(slugArchivo("Año / Señal")).toBe("ano-senal");
  });

  it("usa un nombre por defecto si no queda nada", () => {
    expect(slugArchivo("¡¡¡")).toBe("lista-de-precios");
  });
});

describe("dispositionAdjunto", () => {
  it("incluye el nombre ASCII y el nombre UTF-8 (RFC 5987)", () => {
    expect(dispositionAdjunto("Lista Año (1)", "pdf")).toBe(
      `attachment; filename="lista-ano-1.pdf"; filename*=UTF-8''Lista%20A%C3%B1o%20%281%29.pdf`,
    );
  });
});
