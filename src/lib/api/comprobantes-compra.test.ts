import { describe, expect, it } from "vitest";
import { esErrorDeDatos, parametrosComprobanteApi, validarComprobanteApi } from "./comprobantes-compra";

const PROVEEDOR = "11111111-2222-4333-8444-555555555555";

function cuerpoValido(cambios: Record<string, unknown> = {}) {
  return {
    proveedor: { cuit: "30-71234567-9" },
    tipo: "factura",
    letra: "A",
    punto_venta: 3,
    numero: 1234,
    fecha: "2026-11-05",
    fecha_vencimiento: null,
    cae: "76123456789012",
    cae_vencimiento: "2026-11-15",
    items: [
      {
        codigo: "SPP8",
        descripcion: "SOGA PP diam 8MM",
        unidad: "m",
        cantidad: 100,
        precio_unitario: 120.5,
        descuento_pct: 0,
        alicuota_iva: 21,
      },
    ],
    percepciones: [{ tipo: "otro", descripcion: "Otros impuestos", importe: 350 }],
    ...cambios,
  };
}

function validar(cambios: Record<string, unknown> = {}) {
  const resultado = validarComprobanteApi(cuerpoValido(cambios));
  if ("errores" in resultado) throw new Error(resultado.errores.join(" "));
  return resultado;
}

function errores(cuerpo: unknown): string[] {
  const resultado = validarComprobanteApi(cuerpo);
  return "errores" in resultado ? resultado.errores : [];
}

describe("validarComprobanteApi", () => {
  it("arma los parámetros de guardar_comprobante_compra con origen api y CAE", () => {
    const validado = validar();
    expect(validado.cuit).toBe("30712345679");
    expect(parametrosComprobanteApi(validado, PROVEEDOR)).toEqual({
      p_id: null,
      p_comprobante: {
        proveedor_id: PROVEEDOR,
        tipo: "factura",
        letra: "A",
        punto_venta: 3,
        numero: 1234,
        fecha: "2026-11-05",
        fecha_vencimiento: null,
        observaciones: null,
        comprobante_asociado_id: null,
        cae: "76123456789012",
        cae_vencimiento: "2026-11-15",
        origen: "api",
      },
      p_items: [
        {
          articulo_nuevo: {
            codigo: "SPP8",
            descripcion: "SOGA PP diam 8MM",
            unidad: "m",
            factor_conversion: 1,
            materia_prima_id: null,
          },
          codigo_proveedor: "SPP8",
          descripcion: "SOGA PP diam 8MM",
          unidad: "m",
          cantidad: 100,
          precio_unitario: 120.5,
          descuento_pct: 0,
          alicuota_iva: 21,
          exento: false,
        },
      ],
      p_percepciones: [{ tipo: "otro", jurisdiccion: null, descripcion: "Otros impuestos", importe: 350 }],
    });
  });

  it("los campos opcionales pueden faltar", () => {
    const validado = validar({
      cae: undefined,
      cae_vencimiento: undefined,
      fecha_vencimiento: undefined,
      percepciones: undefined,
      items: [{ descripcion: "Flete", cantidad: 1, precio_unitario: 500, alicuota_iva: 21 }],
    });
    const p = parametrosComprobanteApi(validado, PROVEEDOR);
    expect(p.p_comprobante).toMatchObject({ cae: null, cae_vencimiento: null, fecha_vencimiento: null });
    expect(p.p_percepciones).toEqual([]);
    expect(p.p_items[0]).toMatchObject({
      articulo_nuevo: { codigo: null, descripcion: "Flete", unidad: null, factor_conversion: 1, materia_prima_id: null },
      codigo_proveedor: null,
      unidad: null,
      descuento_pct: 0,
    });
  });

  it("en B y C el renglón va sin alícuota (el precio incluye el IVA)", () => {
    const p = parametrosComprobanteApi(validar({ letra: "B" }), PROVEEDOR);
    expect(p.p_items[0].alicuota_iva).toBeNull();
  });

  it("en B y C igual rechaza una alícuota que no existe", () => {
    expect(errores(cuerpoValido({ letra: "C", items: [{ descripcion: "X", cantidad: 1, precio_unitario: 1, alicuota_iva: 19 }] }))).toEqual([
      "items[0].alicuota_iva: tiene que ser 0, 2.5, 5, 10.5, 21 o 27.",
    ]);
  });

  it("acepta notas de crédito y débito", () => {
    expect(parametrosComprobanteApi(validar({ tipo: "nota_credito" }), PROVEEDOR).p_comprobante.tipo).toBe("nota_credito");
    expect(parametrosComprobanteApi(validar({ tipo: "nota_debito" }), PROVEEDOR).p_comprobante.tipo).toBe("nota_debito");
  });

  it("rechaza lo que no es un objeto", () => {
    expect(errores([])).toEqual(["El cuerpo tiene que ser un objeto JSON."]);
  });

  it("pide el CUIT del proveedor", () => {
    expect(errores(cuerpoValido({ proveedor: undefined }))).toEqual(["proveedor.cuit: es obligatorio."]);
    expect(errores(cuerpoValido({ proveedor: { cuit: "123" } }))).toEqual(["proveedor.cuit: El CUIT tiene que tener 11 dígitos."]);
  });

  it("valida el CAE y su vencimiento", () => {
    expect(errores(cuerpoValido({ cae: "123", cae_vencimiento: "2026-02-30" }))).toEqual([
      "cae: tiene que tener 14 dígitos.",
      "cae_vencimiento: no es una fecha válida (aaaa-mm-dd).",
    ]);
  });

  it("pide al menos un renglón y que items y percepciones sean listas", () => {
    expect(errores(cuerpoValido({ items: [] }))).toEqual(["items: tiene que tener al menos un renglón."]);
    expect(errores(cuerpoValido({ items: "x", percepciones: {} }))).toEqual([
      "items: tiene que ser una lista.",
      "percepciones: tiene que ser una lista.",
    ]);
  });

  it("devuelve los errores de la cabecera y los renglones que controla la pantalla", () => {
    const lista = errores(
      cuerpoValido({
        tipo: "remito",
        punto_venta: 0,
        items: [{ descripcion: "", cantidad: 0, precio_unitario: 1, alicuota_iva: 21 }],
      }),
    );
    expect(lista).toContain("Elegí el tipo de comprobante.");
    expect(lista).toContain("El punto de venta va de 1 a 99999.");
    expect(lista).toContain("Renglón 1: escribí la descripción.");
    expect(lista).toContain("Renglón 1: la cantidad tiene que ser mayor que cero.");
  });
});

describe("esErrorDeDatos", () => {
  it("los errores propios de compras y los controles de la tabla son del pedido", () => {
    for (const code of ["CP009", "RC009", "23514", "23503", "22P02", "22003", "22007", "22008"]) {
      expect(esErrorDeDatos(code)).toBe(true);
    }
  });

  it("el resto es un error del servidor", () => {
    for (const code of [undefined, "", "42501", "40P01", "XX000"]) {
      expect(esErrorDeDatos(code)).toBe(false);
    }
  });
});
