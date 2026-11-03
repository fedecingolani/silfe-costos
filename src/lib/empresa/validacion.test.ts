import { describe, expect, it } from "vitest";
import {
  TAMANO_MAXIMO_LOGO,
  aBase64,
  deBase64,
  esColorHex,
  tipoDeImagen,
  validarDatosEmpresa,
  validarLogo,
} from "./validacion";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

const VACIO = { nombre_fantasia: null, color_marca: null, telefono: null, email: null, web: null };

describe("esColorHex", () => {
  it("acepta #rrggbb en mayúsculas o minúsculas", () => {
    expect(esColorHex("#4a7a58")).toBe(true);
    expect(esColorHex("#4A7A58")).toBe(true);
  });

  it("rechaza otros formatos y texto que no es un color", () => {
    expect(esColorHex("4a7a58")).toBe(false);
    expect(esColorHex("#4a7")).toBe(false);
    expect(esColorHex("#4a7a58ff")).toBe(false);
    expect(esColorHex("#4a7a5g")).toBe(false);
    expect(esColorHex("red; background: url(x)")).toBe(false);
    expect(esColorHex(null)).toBe(false);
  });
});

describe("validarDatosEmpresa", () => {
  it("acepta todo vacío: una instancia nueva puede guardar sin datos", () => {
    expect(validarDatosEmpresa(VACIO)).toEqual({ datos: VACIO });
  });

  it("recorta espacios y deja null los campos vacíos", () => {
    const resultado = validarDatosEmpresa({
      nombre_fantasia: "  Empresa de Ejemplo  ",
      color_marca: " #4A7A58 ",
      telefono: "  ",
      email: " ventas@ejemplo.com.ar ",
      web: "",
    });
    expect(resultado).toEqual({
      datos: {
        nombre_fantasia: "Empresa de Ejemplo",
        color_marca: "#4a7a58",
        telefono: null,
        email: "ventas@ejemplo.com.ar",
        web: null,
      },
    });
  });

  it("rechaza un nombre de más de 80 caracteres", () => {
    const resultado = validarDatosEmpresa({ ...VACIO, nombre_fantasia: "a".repeat(81) });
    expect(resultado).toEqual({ error: expect.stringContaining("80") });
    expect(validarDatosEmpresa({ ...VACIO, nombre_fantasia: "a".repeat(80) })).toHaveProperty("datos");
  });

  it("rechaza un color que no es #rrggbb", () => {
    expect(validarDatosEmpresa({ ...VACIO, color_marca: "verde" })).toHaveProperty("error");
  });

  it("rechaza un email mal formado o demasiado largo", () => {
    expect(validarDatosEmpresa({ ...VACIO, email: "ventas" })).toHaveProperty("error");
    expect(validarDatosEmpresa({ ...VACIO, email: "a b@ejemplo.com" })).toHaveProperty("error");
    expect(validarDatosEmpresa({ ...VACIO, email: `${"a".repeat(250)}@x.com` })).toHaveProperty("error");
  });

  it("rechaza teléfono de más de 40 y web de más de 200 caracteres", () => {
    expect(validarDatosEmpresa({ ...VACIO, telefono: "1".repeat(41) })).toHaveProperty("error");
    expect(validarDatosEmpresa({ ...VACIO, web: "w".repeat(201) })).toHaveProperty("error");
  });
});

describe("tipoDeImagen", () => {
  it("reconoce PNG y JPEG por los bytes iniciales", () => {
    expect(tipoDeImagen(PNG)).toBe("image/png");
    expect(tipoDeImagen(JPEG)).toBe("image/jpeg");
  });

  it("no reconoce otros formatos ni archivos cortos", () => {
    expect(tipoDeImagen(new TextEncoder().encode("GIF89a......"))).toBeNull();
    expect(tipoDeImagen(new TextEncoder().encode("<svg></svg>"))).toBeNull();
    expect(tipoDeImagen(new Uint8Array([0xff, 0xd8]))).toBeNull();
    expect(tipoDeImagen(new Uint8Array())).toBeNull();
  });
});

describe("validarLogo", () => {
  it("devuelve el tipo y el base64 de un PNG válido", () => {
    expect(validarLogo(PNG)).toEqual({ tipo: "image/png", base64: aBase64(PNG) });
  });

  it("decide el tipo por el contenido, no por el nombre o el MIME declarado", () => {
    expect(validarLogo(new TextEncoder().encode("no soy una imagen"))).toEqual({
      error: expect.stringContaining("PNG o JPEG"),
    });
  });

  it("rechaza un archivo de más de 512 KB", () => {
    const grande = new Uint8Array(TAMANO_MAXIMO_LOGO + 1);
    grande.set(JPEG);
    expect(validarLogo(grande)).toEqual({ error: expect.stringContaining("512 KB") });
  });

  it("el base64 del tamaño máximo entra en el límite de la base", () => {
    const maximo = new Uint8Array(TAMANO_MAXIMO_LOGO);
    maximo.set(PNG);
    const resultado = validarLogo(maximo);
    expect("base64" in resultado && resultado.base64.length).toBeLessThanOrEqual(700000);
  });
});

describe("aBase64 / deBase64", () => {
  it("ida y vuelta conserva los bytes", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(Array.from(deBase64(aBase64(bytes)))).toEqual(Array.from(bytes));
  });
});
