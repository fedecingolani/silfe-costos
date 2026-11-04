import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PNG_1X1, PNG_1X1_BASE64 } from "./logo-fixtures";
import { COLUMNAS_EMPRESA_PDF, SIN_IDENTIDAD_PDF, identidadDelPdf, leerEmpresaPdf } from "./pdf-empresa";

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

const FILA = {
  logo_base64: PNG_1X1_BASE64,
  logo_tipo: "image/png",
  nombre_fantasia: "SIL - FE",
  telefono: "0298 444-5555",
  email: "ventas@ejemplo.com.ar",
  web: "www.ejemplo.com.ar",
};

afterEach(() => vi.restoreAllMocks());

describe("identidadDelPdf", () => {
  it("toma el nombre de fantasía y une el contacto con ' · '", () => {
    expect(identidadDelPdf(FILA)).toEqual({
      nombreFantasia: "SIL - FE",
      contacto: "Tel. 0298 444-5555 · ventas@ejemplo.com.ar · www.ejemplo.com.ar",
    });
  });

  it("omite los datos vacíos del contacto", () => {
    expect(identidadDelPdf({ ...FILA, telefono: null, web: "  " }).contacto).toBe("ventas@ejemplo.com.ar");
    expect(identidadDelPdf({ ...FILA, email: null, web: null }).contacto).toBe("Tel. 0298 444-5555");
  });

  it("sin datos queda vacía", () => {
    expect(identidadDelPdf(null)).toEqual(SIN_IDENTIDAD_PDF);
    expect(identidadDelPdf({ nombre_fantasia: null, telefono: null, email: null, web: null })).toEqual({
      nombreFantasia: "",
      contacto: "",
    });
  });
});

describe("leerEmpresaPdf", () => {
  it("lee logo e identidad en una sola consulta, sólo esas columnas", async () => {
    const { cliente, consultas } = clienteStub({ data: FILA, error: null });
    const r = await leerEmpresaPdf(cliente);
    expect(r.logo).toEqual(PNG_1X1);
    expect(r.identidad.nombreFantasia).toBe("SIL - FE");
    expect(consultas).toEqual([{ tabla: "empresa", columnas: COLUMNAS_EMPRESA_PDF }]);
    expect(COLUMNAS_EMPRESA_PDF).toBe("logo_base64, logo_tipo, nombre_fantasia, telefono, email, web");
  });

  it("un logo roto no se lleva la identidad", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente } = clienteStub({ data: { ...FILA, logo_base64: "%%%" }, error: null });
    const r = await leerEmpresaPdf(cliente);
    expect(r.logo).toBeNull();
    expect(r.identidad.nombreFantasia).toBe("SIL - FE");
    expect(aviso).toHaveBeenCalledTimes(1);
  });

  it("nunca falla: sin fila, con error o si lanza, sale sin logo ni identidad", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const vacio = await leerEmpresaPdf(clienteStub({ data: null, error: null }).cliente);
    expect(vacio).toEqual({ logo: null, identidad: SIN_IDENTIDAD_PDF });
    const conError = await leerEmpresaPdf(clienteStub({ data: null, error: { message: "sin permiso" } }).cliente);
    expect(conError).toEqual({ logo: null, identidad: SIN_IDENTIDAD_PDF });
    const lanza = await leerEmpresaPdf(
      clienteStub(() => {
        throw new Error("red");
      }).cliente,
    );
    expect(lanza).toEqual({ logo: null, identidad: SIN_IDENTIDAD_PDF });
    expect(aviso).toHaveBeenCalledTimes(2);
  });
});
