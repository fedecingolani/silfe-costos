import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarPdfComprobante, respuestaPdf } from "./pdf-descarga";
import { COMPROBANTE_EJEMPLO, EMISOR_EJEMPLO, ITEM_EJEMPLO } from "./pdf-fixtures";

const ID = COMPROBANTE_EJEMPLO.id;
const URL_PEDIDO = `https://silfe.test/comprobantes/${ID}/pdf`;

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

const sinLogo = vi.fn(async () => new Response("no", { status: 404 }));

describe("cargarPdfComprobante", () => {
  it("da 404 sin consultar si el id no es un uuid", async () => {
    const { cliente, consultas } = clienteStub(BASE);
    const r = await cargarPdfComprobante({ id: "x", url: URL_PEDIDO, cliente, fetch: sinLogo });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.respuesta.status).toBe(404);
    expect(consultas).toHaveLength(0);
  });

  it("da 404 si el comprobante no existe", async () => {
    const { cliente } = clienteStub({ ...BASE, comprobante: { data: null, error: null } });
    const r = await cargarPdfComprobante({ id: ID, url: URL_PEDIDO, cliente, fetch: sinLogo });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(404);
  });

  it("da 409 con un texto legible si no está autorizado o el punto de venta no es electrónico", async () => {
    const borrador = clienteStub({ ...BASE, comprobante: { data: { ...COMPROBANTE_EJEMPLO, estado: "borrador" }, error: null } });
    const r1 = await cargarPdfComprobante({ id: ID, url: URL_PEDIDO, cliente: borrador.cliente, fetch: sinLogo });
    if (r1.ok) throw new Error("esperaba error");
    expect(r1.respuesta.status).toBe(409);
    expect(await r1.respuesta.text()).toMatch(/autorizado/);

    const manual = clienteStub({ ...BASE, punto_venta: { data: { electronico: false }, error: null } });
    const r2 = await cargarPdfComprobante({ id: ID, url: URL_PEDIDO, cliente: manual.cliente, fetch: sinLogo });
    if (r2.ok) throw new Error("esperaba error");
    expect(r2.respuesta.status).toBe(409);
  });

  it("arma los datos con columnas explícitas y sin leer las credenciales", async () => {
    const { cliente, consultas } = clienteStub(BASE);
    const r = await cargarPdfComprobante({ id: ID, url: URL_PEDIDO, cliente, fetch: sinLogo });
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
    const r = await cargarPdfComprobante({ id: ID, url: URL_PEDIDO, cliente, fetch: sinLogo });
    expect(r.ok).toBe(true);
    expect(aviso.mock.calls.some((c) => String(c[0]).includes("IVA"))).toBe(true);
    aviso.mockRestore();
  });

  it("pide el logo al mismo origen", async () => {
    const png = new Uint8Array([137, 80, 78, 71]);
    const conLogo = vi.fn(async () => new Response(png));
    const { cliente } = clienteStub(BASE);
    const r = await cargarPdfComprobante({ id: ID, url: URL_PEDIDO, cliente, fetch: conLogo });
    if (!r.ok) throw new Error("esperaba ok");
    expect(r.logo).toEqual(png);
    expect(String((conLogo.mock.calls[0] as unknown[])[0])).toBe("https://silfe.test/logo-silfe.png");
  });
});

describe("respuestaPdf", () => {
  it("abre el PDF en el navegador con el nombre del comprobante", () => {
    const r = respuestaPdf(new Uint8Array([37, 80, 68, 70]), "Factura A-00007-00000361");
    expect(r.headers.get("Content-Type")).toBe("application/pdf");
    expect(r.headers.get("Content-Disposition")).toMatch(/^inline; filename="Factura A-00007-00000361\.pdf"/);
  });
});
