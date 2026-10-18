import { describe, expect, it } from "vitest";
import { formatearNumero } from "./numero";

describe("formatearNumero", () => {
  it("completa punto de venta a 5 dígitos y número a 8", () => {
    expect(formatearNumero("A", 7, 361)).toBe("A-00007-00000361");
    expect(formatearNumero("B", 99999, 12345678)).toBe("B-99999-12345678");
  });
});
