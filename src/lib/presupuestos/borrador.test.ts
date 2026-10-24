import { describe, expect, it } from "vitest";
import type { ProductoCatalogo } from "@/lib/comprobantes/borrador";
import {
  armarPresupuesto,
  mensajeErrorGuardado,
  validezPorDefecto,
  type PresupuestoEnviado,
} from "./borrador";

const CLIENTE = "c0000000-0000-0000-0000-000000000001";
const PRODUCTO = "p0000000-0000-0000-0000-000000000001";
const LISTA = "a0000000-0000-0000-0000-000000000001";

const productos = new Map<string, ProductoCatalogo>([
  [PRODUCTO, { id: PRODUCTO, codigo: "LON-01", nombre: "Lona cosechera", alicuota_iva: 21, unidad: "Docena" }],
]);

const contexto = { productos };

const enviado = (cambios: Partial<PresupuestoEnviado> = {}): PresupuestoEnviado => ({
  clienteId: CLIENTE,
  fecha: "2026-10-16",
  validoHasta: "2026-10-31",
  fechaVencimientoPago: "2026-10-30",
  condicionPago: "cuenta_corriente",
  listaPrecioId: LISTA,
  observaciones: "  Entrega en planta ",
  items: [
    {
      productoId: PRODUCTO,
      descripcion: "lo que mande el navegador",
      observaciones: "Color verde",
      cantidad: "2",
      precioUnitario: "1000,5",
      descuentoPct: "10",
      alicuotaIva: "10.5",
    },
    {
      productoId: null,
      descripcion: " Desarrollo de producto ",
      observaciones: "",
      cantidad: "1",
      precioUnitario: "500",
      descuentoPct: "",
      alicuotaIva: "10.5",
    },
  ],
  ...cambios,
});

describe("validezPorDefecto", () => {
  it("es la fecha más 15 días, cruzando meses y años", () => {
    expect(validezPorDefecto("2026-10-16")).toBe("2026-10-31");
    expect(validezPorDefecto("2026-10-20")).toBe("2026-11-04");
    expect(validezPorDefecto("2026-12-25")).toBe("2027-01-09");
  });

  it("sin una fecha válida devuelve vacío", () => {
    expect(validezPorDefecto("")).toBe("");
    expect(validezPorDefecto("2026-02-30")).toBe("");
  });
});

describe("armarPresupuesto", () => {
  it("arma la cabecera y los ítems para guardar_presupuesto, con totales calculados en el servidor", () => {
    expect(armarPresupuesto(enviado(), contexto)).toEqual({
      presupuesto: {
        cabecera: {
          cliente_id: CLIENTE,
          fecha: "2026-10-16",
          valido_hasta: "2026-10-31",
          fecha_vencimiento_pago: "2026-10-30",
          condicion_pago: "cuenta_corriente",
          lista_precio_id: LISTA,
          observaciones: "Entrega en planta",
          neto: 2300.9,
          no_gravado: 0,
          iva: 430.69,
          total: 2731.59,
        },
        items: [
          {
            producto_id: PRODUCTO,
            codigo: "LON-01",
            descripcion: "Lona cosechera",
            observaciones: "Color verde",
            unidad: "Docena",
            cantidad: 2,
            precio_unitario: 1000.5,
            descuento_pct: 10,
            gravado: true,
            alicuota_iva: 21,
            importe: 1800.9,
            iva: 378.19,
          },
          {
            producto_id: null,
            codigo: null,
            descripcion: "Desarrollo de producto",
            observaciones: null,
            unidad: null,
            cantidad: 1,
            precio_unitario: 500,
            descuento_pct: 0,
            gravado: true,
            alicuota_iva: 10.5,
            importe: 500,
            iva: 52.5,
          },
        ],
      },
    });
  });

  it("sin «válido hasta» toma la fecha más 15 días", () => {
    const resultado = armarPresupuesto(enviado({ validoHasta: "" }), contexto);
    expect("presupuesto" in resultado && resultado.presupuesto.cabecera.valido_hasta).toBe("2026-10-31");
  });

  it("acepta «válido hasta» igual a la fecha", () => {
    const resultado = armarPresupuesto(enviado({ validoHasta: "2026-10-16" }), contexto);
    expect("presupuesto" in resultado && resultado.presupuesto.cabecera.valido_hasta).toBe("2026-10-16");
  });

  it("con contado guarda el vencimiento igual a la fecha", () => {
    const resultado = armarPresupuesto(enviado({ condicionPago: "contado" }), contexto);
    expect("presupuesto" in resultado && resultado.presupuesto.cabecera.fecha_vencimiento_pago).toBe("2026-10-16");
  });

  it("los ítems no gravados suman en no_gravado, sin alícuota ni IVA", () => {
    const resultado = armarPresupuesto(
      enviado({ items: [{ ...enviado().items[1], alicuotaIva: "no_gravado" }] }),
      contexto,
    );
    if (!("presupuesto" in resultado)) throw new Error(JSON.stringify(resultado));
    expect(resultado.presupuesto.items[0]).toMatchObject({ gravado: false, alicuota_iva: null, iva: 0 });
    expect(resultado.presupuesto.cabecera).toMatchObject({ neto: 0, no_gravado: 500, iva: 0, total: 500 });
  });

  it("sin lista de precios guarda la lista vacía", () => {
    const resultado = armarPresupuesto(enviado({ listaPrecioId: null }), contexto);
    expect("presupuesto" in resultado && resultado.presupuesto.cabecera.lista_precio_id).toBeNull();
  });

  it("pide al menos un ítem", () => {
    expect(armarPresupuesto(enviado({ items: [] }), contexto)).toEqual({ errores: ["Agregá al menos un ítem."] });
  });

  it("rechaza «válido hasta» anterior a la fecha o inválido", () => {
    expect(armarPresupuesto(enviado({ validoHasta: "2026-10-15" }), contexto)).toEqual({
      errores: ["«Válido hasta» no puede ser anterior a la fecha."],
    });
    expect(armarPresupuesto(enviado({ validoHasta: "2026-13-01" }), contexto)).toEqual({
      errores: ["La fecha «válido hasta» no es válida."],
    });
  });

  it("aplica las reglas de la factura al vencimiento del cobro", () => {
    expect(armarPresupuesto(enviado({ fechaVencimientoPago: "2026-10-01" }), contexto)).toEqual({
      errores: ["El vencimiento del cobro no puede ser anterior a la fecha."],
    });
    expect(armarPresupuesto(enviado({ fechaVencimientoPago: "" }), contexto)).toEqual({
      errores: ["El vencimiento del cobro no es válido."],
    });
  });

  it("junta todos los errores, con los de los ítems iguales a los de la factura", () => {
    const resultado = armarPresupuesto(
      enviado({
        clienteId: "",
        fecha: "2026-02-30",
        condicionPago: "otra" as PresupuestoEnviado["condicionPago"],
        items: [
          { ...enviado().items[1], descripcion: " ", cantidad: "0", precioUnitario: "-1", descuentoPct: "120" },
          { ...enviado().items[0], productoId: "inexistente" },
        ],
      }),
      contexto,
    );
    expect(resultado).toEqual({
      errores: [
        "Elegí el cliente.",
        "La fecha del presupuesto no es válida.",
        "Elegí la condición de pago.",
        "Ítem 1: completá la descripción.",
        "Ítem 1: la cantidad tiene que ser mayor a cero.",
        "Ítem 1: el precio no puede ser negativo.",
        "Ítem 1: el descuento tiene que estar entre 0 y 100.",
        "Ítem 2: el producto ya no existe.",
      ],
    });
  });

  it("rechaza datos que no son un presupuesto", () => {
    expect(armarPresupuesto(null, contexto)).toEqual({ errores: ["Los datos del presupuesto no son válidos."] });
    expect(armarPresupuesto({ clienteId: CLIENTE }, contexto)).toEqual({
      errores: ["Los datos del presupuesto no son válidos."],
    });
  });
});

describe("mensajeErrorGuardado", () => {
  it.each([
    ["PR001", "El presupuesto está convertido: no se puede modificar ni borrar."],
    ["PR002", "El presupuesto cambió de estado. Recargá la página."],
    ["PR003", "Sólo se pueden borrar presupuestos abiertos."],
    ["PR004", "No se encontró el presupuesto. Puede que lo hayan borrado."],
    ["PR005", "El presupuesto ya se convirtió en factura."],
    ["PR006", "El número del presupuesto no se puede cambiar."],
    ["PR007", "No hay un punto de venta electrónico activo para generar la factura."],
    ["23503", "El cliente, la lista de precios o un producto ya no existen. Recargá la página."],
  ])("traduce %s", (code, mensaje) => {
    expect(mensajeErrorGuardado({ code, message: "x" })).toBe(mensaje);
  });

  it("reconoce el error por la pista aunque no venga el código", () => {
    expect(mensajeErrorGuardado({ message: "x", hint: "presupuesto_ya_convertido" })).toBe(
      "El presupuesto ya se convirtió en factura.",
    );
  });

  it.each([
    ["presupuesto_valido_hasta_check", "«Válido hasta» no puede ser anterior a la fecha."],
    ["presupuesto_vencimiento_check", "El vencimiento del cobro no puede ser anterior a la fecha."],
    ["presupuesto_item_cantidad_check", "Revisá los ítems: hay datos que no son válidos."],
  ])("traduce el control %s", (restriccion, mensaje) => {
    const message = `new row for relation "presupuesto" violates check constraint "${restriccion}"`;
    expect(mensajeErrorGuardado({ code: "23514", message })).toBe(mensaje);
  });

  it("deja el resto con el mensaje de la base", () => {
    expect(mensajeErrorGuardado({ code: "XX000", message: "algo" })).toBe("No se pudo guardar el presupuesto: algo");
  });
});
