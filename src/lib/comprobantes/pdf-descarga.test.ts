import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarPdfComprobante, respuestaPdf } from "./pdf-descarga";
import { PNG_1X1, PNG_1X1_BASE64 } from "@/lib/empresa/logo-fixtures";
import { COLUMNAS_EMPRESA_PDF } from "@/lib/empresa/pdf-empresa";
import { COMPROBANTE_EJEMPLO, EMISOR_EJEMPLO, EMPRESA_EJEMPLO, ITEM_EJEMPLO } from "./pdf-fixtures";

const ID = COMPROBANTE_EJEMPLO.id;

type Respuesta = { data: unknown; error: { message: string } | null };

/** Cliente de Supabase mínimo: cada tabla devuelve una respuesta fija y registra las columnas pedidas. */
function clienteStub(respuestas: Record<string, Respuesta>) {
  const consultas: { tabla: string; columnas: string }[] = [];
  const cliente = {
    from(tabla: string) {
      const respuesta = respuestas[tabla] ?? { data: null, error: null };
      const constructor = {
        select: (columnas: string) => {
          consultas.push({ tabla, columnas });
          return constructor;
        },
        eq: () => constructor,
        in: () => constructor,
        then: (resolver: (r: Respuesta) => unknown, rechazar?: (e: unknown) => unknown) =>
          Promise.resolve(respuesta).then(resolver, rechazar),
        order: () => Promise.resolve(respuesta),
        maybeSingle: () => Promise.resolve(respuesta),
      };
      return constructor;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, consultas };
}

const BASE = {
  comprobante: { data: COMPROBANTE_EJEMPLO, error: null },
  comprobante_item: { data: [ITEM_EJEMPLO], error: null },
  arca_emisor: { data: EMISOR_EJEMPLO, error: null },
  punto_venta: { data: { electronico: true }, error: null },
};

describe("cargarPdfComprobante", () => {
  it("da 404 sin consultar si el id no es un uuid", async () => {
    const { cliente, consultas } = clienteStub(BASE);
    const r = await cargarPdfComprobante({ id: "x", cliente });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.respuesta.status).toBe(404);
    expect(consultas).toHaveLength(0);
  });

  it("da 404 si el comprobante no existe", async () => {
    const { cliente } = clienteStub({ ...BASE, comprobante: { data: null, error: null } });
    const r = await cargarPdfComprobante({ id: ID, cliente });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(404);
  });

  it("da 409 con un texto legible si no está autorizado o el punto de venta no es electrónico", async () => {
    const borrador = clienteStub({ ...BASE, comprobante: { data: { ...COMPROBANTE_EJEMPLO, estado: "borrador" }, error: null } });
    const r1 = await cargarPdfComprobante({ id: ID, cliente: borrador.cliente });
    if (r1.ok) throw new Error("esperaba error");
    expect(r1.respuesta.status).toBe(409);
    expect(await r1.respuesta.text()).toMatch(/autorizado/);

    const manual = clienteStub({ ...BASE, punto_venta: { data: { electronico: false }, error: null } });
    const r2 = await cargarPdfComprobante({ id: ID, cliente: manual.cliente });
    if (r2.ok) throw new Error("esperaba error");
    expect(r2.respuesta.status).toBe(409);
  });

  it("arma los datos con columnas explícitas y sin leer las credenciales", async () => {
    const { cliente, consultas } = clienteStub(BASE);
    const r = await cargarPdfComprobante({ id: ID, cliente });
    if (!r.ok) throw new Error(await r.respuesta.text());
    expect(r.datos.numero).toBe("A-00007-00000361");
    expect(r.logo).toBeNull();
    expect(consultas.map((c) => c.tabla)).not.toContain("arca_credencial");
    expect(consultas.every((c) => !c.columnas.includes("*"))).toBe(true);
  });

  it("avisa en el log si el IVA por alícuota guardado no coincide con el IVA del comprobante", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const distinto = { ...COMPROBANTE_EJEMPLO, iva_detalle: [{ id: 5, alicuota: 21, base: 1400000, importe: 1 }] };
    const { cliente } = clienteStub({ ...BASE, comprobante: { data: distinto, error: null } });
    const r = await cargarPdfComprobante({ id: ID, cliente });
    expect(r.ok).toBe(true);
    expect(aviso.mock.calls.some((c) => String(c[0]).includes("IVA"))).toBe(true);
    aviso.mockRestore();
  });

  it("imprime el comprobante asociado de una nota de crédito, de la base o cargado a mano", async () => {
    const nota = { ...COMPROBANTE_EJEMPLO, clase: "nota_credito", tipo_arca: 3 };
    const { cliente, consultas } = clienteStub({
      ...BASE,
      comprobante: { data: nota, error: null },
      comprobante_asociado: {
        data: [{ asociado_id: null, tipo_arca: 1, punto_venta: 7, numero: 150, fecha: "2026-01-09" }],
        error: null,
      },
    });
    const r = await cargarPdfComprobante({ id: ID, cliente });
    if (!r.ok) throw new Error(await r.respuesta.text());
    expect(r.datos.asociados).toEqual(["A-00007-00000150 del 09/01/2026"]);
    expect(consultas.find((c) => c.tabla === "comprobante_asociado")?.columnas).not.toContain("*");
  });

  it("lee el logo y la identidad de la empresa en una consulta, sólo sus columnas", async () => {
    const { cliente, consultas } = clienteStub({
      ...BASE,
      empresa: { data: { ...EMPRESA_EJEMPLO, logo_base64: PNG_1X1_BASE64, logo_tipo: "image/png" }, error: null },
    });
    const r = await cargarPdfComprobante({ id: ID, cliente });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.logo).toEqual(PNG_1X1);
    expect(r.datos.emisor.nombreFantasia).toBe("SIL - FE");
    expect(r.datos.emisor.contacto).toContain("ventas@ejemplo.com.ar");
    expect(consultas.filter((c) => c.tabla === "empresa").map((c) => c.columnas)).toEqual([COLUMNAS_EMPRESA_PDF]);
  });

  it("sale sin logo si falla la lectura del logo", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente } = clienteStub({ ...BASE, empresa: { data: null, error: { message: "fallo de red" } } });
    const r = await cargarPdfComprobante({ id: ID, cliente });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.logo).toBeNull();
    expect(r.datos.emisor.nombreFantasia).toBe("");
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

describe("respuestaPdf", () => {
  it("abre el PDF en el navegador con el nombre del comprobante", () => {
    const r = respuestaPdf(new Uint8Array([37, 80, 68, 70]), "Factura A-00007-00000361");
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Disposition")).toMatch(/^inline; filename="Factura A-00007-00000361\.pdf"/);
  });
});
