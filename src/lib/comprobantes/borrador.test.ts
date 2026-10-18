import { describe, expect, it } from "vitest";
import {
  aDecimal,
  alicuotaArca,
  armarBorrador,
  buscarProductos,
  itemParaCalcular,
  mapaPrecios,
  mensajeErrorGuardado,
  precioPropuesto,
  vencimientoPara,
  type BorradorEnviado,
  type ProductoCatalogo,
} from "./borrador";

const CLIENTE = "c0000000-0000-0000-0000-000000000001";
const PRODUCTO = "p0000000-0000-0000-0000-000000000001";
const LISTA = "a0000000-0000-0000-0000-000000000001";

const productos = new Map<string, ProductoCatalogo>([
  [PRODUCTO, { id: PRODUCTO, codigo: "LON-01", nombre: "Lona cosechera", alicuota_iva: 21, unidad: "Docena" }],
]);

const enviado = (cambios: Partial<BorradorEnviado> = {}): BorradorEnviado => ({
  clienteId: CLIENTE,
  clase: "factura",
  fecha: "2026-10-16",
  fechaVencimientoPago: "2026-10-30",
  condicionPago: "cuenta_corriente",
  listaPrecioId: LISTA,
  puntoVenta: 7,
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

const contexto = { productos, condicionIvaCliente: "Responsable Inscripto" as const };

describe("aDecimal", () => {
  it.each([
    ["1,5", 1.5],
    [" 2.25 ", 2.25],
    ["0", 0],
    [3, 3],
    ["", null],
    ["abc", null],
    [null, null],
  ])("%j → %j", (entrada, salida) => {
    expect(aDecimal(entrada)).toBe(salida);
  });
});

describe("vencimientoPara", () => {
  it("con contado, el vencimiento es la fecha", () => {
    expect(vencimientoPara("contado", "2026-10-16", "2026-11-30")).toBe("2026-10-16");
  });
  it("con cuenta corriente respeta el vencimiento elegido", () => {
    expect(vencimientoPara("cuenta_corriente", "2026-10-16", "2026-11-30")).toBe("2026-11-30");
  });
  it("nunca queda antes de la fecha ni vacío", () => {
    expect(vencimientoPara("cuenta_corriente", "2026-10-16", "2026-10-01")).toBe("2026-10-16");
    expect(vencimientoPara("cuenta_corriente", "2026-10-16", "")).toBe("2026-10-16");
  });
});

describe("precios de la lista", () => {
  const mapa = mapaPrecios([
    { producto_id: PRODUCTO, precio_final: "1234.5678" },
    { producto_id: PRODUCTO, precio_final: 1 },
    { producto_id: null, precio_final: 99 },
  ]);

  it("propone el precio final de la lista (el primero si el producto aparece dos veces)", () => {
    expect(precioPropuesto(mapa, PRODUCTO)).toEqual({ precio: 1234.5678, enLista: true });
  });

  it("propone 0 si el producto no está en la lista", () => {
    expect(precioPropuesto(mapa, "otro")).toEqual({ precio: 0, enLista: false });
  });
});

describe("alicuotaArca", () => {
  it("acepta sólo las alícuotas de ARCA", () => {
    expect(alicuotaArca(10.5)).toBe(10.5);
    expect(alicuotaArca("21")).toBe(21);
    expect(alicuotaArca(19)).toBeNull();
  });
});

describe("itemParaCalcular", () => {
  it("convierte una fila de la pantalla para el cálculo en vivo", () => {
    expect(itemParaCalcular(enviado().items[0])).toEqual({
      cantidad: 2,
      precioUnitario: 1000.5,
      descuentoPct: 10,
      alicuotaIva: 10.5,
    });
  });
  it("devuelve null mientras la fila está incompleta", () => {
    expect(itemParaCalcular({ ...enviado().items[0], cantidad: "" })).toBeNull();
    expect(itemParaCalcular({ ...enviado().items[0], alicuotaIva: "19" })).toBeNull();
  });
});

describe("armarBorrador", () => {
  it("arma la cabecera y los ítems para guardar, con totales calculados en el servidor", () => {
    const resultado = armarBorrador(enviado(), contexto);
    expect(resultado).toEqual({
      borrador: {
        // Una factura no lleva asociados: se guardan vacíos.
        asociados: [],
        cabecera: {
          punto_venta: 7,
          clase: "factura",
          letra: "A",
          tipo_arca: 1,
          fecha: "2026-10-16",
          fecha_vencimiento_pago: "2026-10-30",
          cliente_id: CLIENTE,
          lista_precio_id: LISTA,
          condicion_pago: "cuenta_corriente",
          observaciones: "Entrega en planta",
          periodo_asoc_desde: null,
          periodo_asoc_hasta: null,
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

  it("con contado guarda el vencimiento igual a la fecha", () => {
    const resultado = armarBorrador(enviado({ condicionPago: "contado" }), contexto);
    expect("borrador" in resultado && resultado.borrador.cabecera.fecha_vencimiento_pago).toBe("2026-10-16");
  });

  it("sin condición IVA del cliente guarda el borrador sin letra", () => {
    const resultado = armarBorrador(enviado(), { ...contexto, condicionIvaCliente: null });
    expect("borrador" in resultado && resultado.borrador.cabecera).toMatchObject({ letra: null, tipo_arca: null });
  });

  it("un borrador puede no tener ítems todavía", () => {
    const resultado = armarBorrador(enviado({ items: [] }), contexto);
    expect("borrador" in resultado && resultado.borrador.cabecera.total).toBe(0);
  });

  it("junta todos los errores", () => {
    const resultado = armarBorrador(
      enviado({
        clienteId: "",
        fecha: "2026-02-30",
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
        "La fecha del comprobante no es válida.",
        "Ítem 1: completá la descripción.",
        "Ítem 1: la cantidad tiene que ser mayor a cero.",
        "Ítem 1: el precio no puede ser negativo.",
        "Ítem 1: el descuento tiene que estar entre 0 y 100.",
        "Ítem 2: el producto ya no existe.",
      ],
    });
  });

  it("rechaza un producto con una alícuota que ARCA no acepta", () => {
    const raros = new Map(productos);
    raros.set(PRODUCTO, { ...productos.get(PRODUCTO)!, alicuota_iva: 19 });
    expect(armarBorrador(enviado({ items: [enviado().items[0]] }), { ...contexto, productos: raros })).toEqual({
      errores: ["Ítem 1: el producto LON-01 tiene una alícuota de IVA (19%) que ARCA no acepta. Corregila en el producto."],
    });
  });

  it("rechaza datos que no son un borrador", () => {
    expect(armarBorrador(null, contexto)).toEqual({ errores: ["Los datos del comprobante no son válidos."] });
  });
});

describe("armarBorrador: ítems no gravados", () => {
  const conNoGravado = () =>
    enviado({
      items: [
        { ...enviado().items[0], alicuotaIva: "no_gravado" },
        { ...enviado().items[1], alicuotaIva: "no_gravado" },
      ],
    });

  it("un ítem libre o de producto pasa a no gravado: sin alícuota ni IVA, y suma en no_gravado", () => {
    const resultado = armarBorrador(conNoGravado(), contexto);
    if (!("borrador" in resultado)) throw new Error(JSON.stringify(resultado));
    expect(resultado.borrador.items.map((i) => [i.gravado, i.alicuota_iva, i.importe, i.iva])).toEqual([
      [false, null, 1800.9, 0],
      [false, null, 500, 0],
    ]);
    expect(resultado.borrador.cabecera).toMatchObject({ neto: 0, no_gravado: 2300.9, iva: 0, total: 2300.9 });
  });

  it("un producto con otra alícuota enviada conserva la del catálogo", () => {
    const resultado = armarBorrador(enviado(), contexto);
    expect("borrador" in resultado && resultado.borrador.items[0]).toMatchObject({ gravado: true, alicuota_iva: 21 });
  });

  it("calcula en vivo un renglón no gravado", () => {
    expect(itemParaCalcular({ ...enviado().items[1], alicuotaIva: "no_gravado" })).toEqual({
      cantidad: 1,
      precioUnitario: 500,
      descuentoPct: 0,
      alicuotaIva: "no_gravado",
    });
  });
});

describe("mensajeErrorGuardado", () => {
  it.each([
    ["CM004", "El comprobante ya no es un borrador: no se puede modificar. Recargá la página."],
    ["CM001", "El comprobante está autorizado: no se puede modificar. Para corregirlo, emití una nota de crédito."],
    ["CM006", "No se encontró el comprobante. Puede que lo hayan borrado."],
    ["23503", "El cliente, la lista de precios o el punto de venta ya no existen. Recargá la página."],
  ])("traduce %s", (code, mensaje) => {
    expect(mensajeErrorGuardado({ code, message: "x" })).toBe(mensaje);
  });

  it("muestra tal cual el bloqueo de la ND de un cheque rechazado", () => {
    const message = "Es la nota de débito del cheque rechazado N° 71 (Banco Nación): no se puede borrar. Revisala y autorizala.";
    expect(mensajeErrorGuardado({ code: "CB020", message })).toBe(message);
  });

  it("deja el resto con el mensaje de la base", () => {
    expect(mensajeErrorGuardado({ code: "XX000", message: "algo" })).toBe("No se pudo guardar el comprobante: algo");
  });
});

describe("buscarProductos", () => {
  const catalogo = [
    { codigo: "COR-02", nombre: "Correa reforzada" },
    { codigo: "LON-01", nombre: "Lona cosechera" },
    { codigo: "MAL-01", nombre: "Malla antigranizo con lona" },
  ];

  it("busca por código o nombre, sin acentos ni mayúsculas, con todas las palabras", () => {
    expect(buscarProductos(catalogo, "LONA").map((p) => p.codigo)).toEqual(["LON-01", "MAL-01"]);
    expect(buscarProductos(catalogo, "malla lona").map((p) => p.codigo)).toEqual(["MAL-01"]);
    expect(buscarProductos(catalogo, "cosechéra").map((p) => p.codigo)).toEqual(["LON-01"]);
  });

  it("pone primero los que empiezan con el texto en el código", () => {
    expect(buscarProductos(catalogo, "l").map((p) => p.codigo)[0]).toBe("LON-01");
  });

  it("sin texto no devuelve nada y respeta el límite", () => {
    expect(buscarProductos(catalogo, "  ")).toEqual([]);
    expect(buscarProductos(catalogo, "o", 2)).toHaveLength(2);
  });
});

describe("armarBorrador: notas asociadas a un período", () => {
  const periodo = { desde: "2026-10-01", hasta: "2026-10-15" };
  const armar = (cambios: Partial<BorradorEnviado>, extra: Partial<Parameters<typeof armarBorrador>[1]> = {}) =>
    armarBorrador(enviado(cambios), { ...contexto, cuitEmisor: "23334771229", ...extra });

  it("guarda el período, sin comprobantes asociados, y la letra sale del cliente", () => {
    const r = armar({ clase: "nota_debito", periodoAsociado: periodo }, { condicionIvaCliente: "Consumidor Final" });
    if ("errores" in r) throw new Error(r.errores.join(" "));
    expect(r.borrador.cabecera).toMatchObject({
      letra: "B",
      tipo_arca: 7,
      periodo_asoc_desde: "2026-10-01",
      periodo_asoc_hasta: "2026-10-15",
    });
    expect(r.borrador.asociados).toEqual([]);
  });

  it("no acepta a la vez un comprobante cargado a mano y un período", () => {
    const manual = { tipoArca: "6", puntoVenta: "7", numero: "150", fecha: "2026-01-10" };
    expect(armar({ clase: "nota_debito", asociadoManual: manual, periodoAsociado: periodo })).toEqual({
      errores: ["Una nota se asocia a comprobantes o a un período, no a los dos."],
    });
  });

  it("informa un período inválido", () => {
    const r = armar({ clase: "nota_debito", periodoAsociado: { desde: "2026-10-15", hasta: "2026-10-01" } });
    expect(r).toEqual({ errores: ["Período asociado: el desde no puede ser posterior al hasta."] });
  });

  it("una factura y una nota con asociado de la base descartan el período", () => {
    const factura = armar({ clase: "factura", periodoAsociado: periodo });
    expect("borrador" in factura && factura.borrador.cabecera).toMatchObject({
      periodo_asoc_desde: null,
      periodo_asoc_hasta: null,
    });
    const nota = armar({ clase: "nota_credito", periodoAsociado: periodo }, { asociadoInterno: { tipoArca: 1 } });
    expect("borrador" in nota && nota.borrador.cabecera).toMatchObject({ periodo_asoc_desde: null });
  });
});

describe("armarBorrador: notas con comprobante asociado", () => {
  const manual = { tipoArca: "6", puntoVenta: "7", numero: "150", fecha: "2026-01-10" };
  const armar = (cambios: Partial<BorradorEnviado>, extra: Partial<Parameters<typeof armarBorrador>[1]> = {}) =>
    armarBorrador(enviado(cambios), { ...contexto, cuitEmisor: "23334771229", ...extra });

  it("con un asociado de la base, la letra es la del asociado aunque el cliente hoy dé otra, y no se tocan los asociados", () => {
    const r = armar(
      { clase: "nota_credito" },
      { condicionIvaCliente: "Consumidor Final", asociadoInterno: { tipoArca: 1 } },
    );
    if ("errores" in r) throw new Error(r.errores.join(" "));
    expect(r.borrador.cabecera).toMatchObject({ letra: "A", tipo_arca: 3 });
    expect(r.borrador.asociados).toBeNull();
  });

  it("no deja pasar a factura un comprobante asociado a otro", () => {
    expect(armar({ clase: "factura" }, { asociadoInterno: { tipoArca: 1 } })).toEqual({
      errores: ["Una factura no lleva comprobante asociado."],
    });
  });

  it("con un asociado cargado a mano, la letra sale de su tipo y se guarda con la CUIT del emisor", () => {
    const r = armar({ clase: "nota_credito", asociadoManual: manual });
    if ("errores" in r) throw new Error(r.errores.join(" "));
    expect(r.borrador.cabecera).toMatchObject({ letra: "B", tipo_arca: 8 });
    expect(r.borrador.asociados).toEqual([
      { tipo_arca: 6, punto_venta: 7, numero: 150, fecha: "2026-01-10", cuit: "23334771229" },
    ]);
  });

  it("una nota sin asociado se guarda como borrador (la letra sale del cliente) y queda sin asociados", () => {
    const r = armar({ clase: "nota_debito", asociadoManual: null });
    if ("errores" in r) throw new Error(r.errores.join(" "));
    expect(r.borrador.cabecera).toMatchObject({ letra: "A", tipo_arca: 2 });
    expect(r.borrador.asociados).toEqual([]);
  });

  it("una factura descarta el asociado cargado a mano", () => {
    const r = armar({ clase: "factura", asociadoManual: manual });
    if ("errores" in r) throw new Error(r.errores.join(" "));
    expect(r.borrador.asociados).toEqual([]);
  });

  it("informa los errores del asociado cargado a mano", () => {
    const r = armar({ clase: "nota_credito", asociadoManual: { ...manual, numero: "0" } });
    expect(r).toEqual({ errores: ["Comprobante asociado: el número tiene que ser un entero mayor a cero."] });
  });
});
