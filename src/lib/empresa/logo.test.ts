import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PDFDocument } from "pdf-lib";
import { leerLogoEmpresa } from "./logo";
import { JPEG_1X1, JPEG_1X1_BASE64, PNG_1X1, PNG_1X1_BASE64 } from "./logo-fixtures";
import { incrustarLogo } from "./pdf-logo";

type Respuesta = { data: unknown; error: { message: string } | null };

function clienteStub(respuesta: Respuesta | (() => never)) {
  const consultas: { tabla: string; columnas: string }[] = [];
  const cliente = {
    from(tabla: string) {
      const constructor = {
        select: (columnas: string) => {
          consultas.push({ tabla, columnas });
          return constructor;
        },
        eq: () => constructor,
        maybeSingle: async () => (typeof respuesta === "function" ? respuesta() : respuesta),
      };
      return constructor;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, consultas };
}

afterEach(() => vi.restoreAllMocks());

describe("leerLogoEmpresa", () => {
  it("devuelve los bytes y el tipo del logo guardado, leyendo sólo esas columnas", async () => {
    const { cliente, consultas } = clienteStub({
      data: { logo_base64: PNG_1X1_BASE64, logo_tipo: "image/png" },
      error: null,
    });
    expect(await leerLogoEmpresa(cliente)).toEqual({ bytes: PNG_1X1, tipo: "image/png" });
    expect(consultas).toEqual([{ tabla: "empresa", columnas: "logo_base64, logo_tipo" }]);
  });

  it("devuelve null si no hay logo cargado", async () => {
    const { cliente } = clienteStub({ data: { logo_base64: null, logo_tipo: null }, error: null });
    expect(await leerLogoEmpresa(cliente)).toBeNull();
    const vacio = clienteStub({ data: null, error: null });
    expect(await leerLogoEmpresa(vacio.cliente)).toBeNull();
  });

  it("nunca falla: un error de la base o un base64 roto dan null con un aviso", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const conError = clienteStub({ data: null, error: { message: "sin permiso" } });
    expect(await leerLogoEmpresa(conError.cliente)).toBeNull();
    const roto = clienteStub({ data: { logo_base64: "%%%", logo_tipo: "image/png" }, error: null });
    expect(await leerLogoEmpresa(roto.cliente)).toBeNull();
    const lanza = clienteStub(() => {
      throw new Error("red");
    });
    expect(await leerLogoEmpresa(lanza.cliente)).toBeNull();
    expect(aviso).toHaveBeenCalledTimes(3);
  });
});

describe("incrustarLogo", () => {
  it("incrusta un PNG y un JPEG según su contenido", async () => {
    const doc = await PDFDocument.create();
    const png = await incrustarLogo(doc, PNG_1X1);
    const jpeg = await incrustarLogo(doc, JPEG_1X1);
    expect(png).toMatchObject({ width: 1, height: 1 });
    expect(jpeg).toMatchObject({ width: 1, height: 1 });
    expect(JPEG_1X1_BASE64.startsWith("/9j/")).toBe(true);
  });

  it("devuelve null sin logo o con bytes que no son una imagen", async () => {
    const doc = await PDFDocument.create();
    expect(await incrustarLogo(doc, null)).toBeNull();
    expect(await incrustarLogo(doc, new Uint8Array([1, 2, 3]))).toBeNull();
    // Firma de PNG con el resto roto.
    expect(await incrustarLogo(doc, PNG_1X1.slice(0, 12))).toBeNull();
  });
});
