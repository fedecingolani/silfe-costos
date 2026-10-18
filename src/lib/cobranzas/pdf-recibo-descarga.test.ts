import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMISOR_EJEMPLO } from "@/lib/comprobantes/pdf-fixtures";
import { cargarPdfRecibo } from "./pdf-recibo-descarga";
import {
  CLIENTE_RECIBO_EJEMPLO,
  IMPUTACIONES_EJEMPLO,
  MEDIOS_EJEMPLO,
  RECIBO_EJEMPLO,
} from "./pdf-recibo-fixtures";

const ID = RECIBO_EJEMPLO.id;
const URL_PEDIDO = `https://silfe.test/cobranzas/${ID}/pdf`;

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

const BASE: Record<string, Respuesta> = {
  recibo: { data: { ...RECIBO_EJEMPLO, cliente_id: "c1" }, error: null },
  cliente: { data: CLIENTE_RECIBO_EJEMPLO, error: null },
  recibo_medio: { data: MEDIOS_EJEMPLO, error: null },
  imputacion: { data: IMPUTACIONES_EJEMPLO, error: null },
  arca_emisor: { data: EMISOR_EJEMPLO, error: null },
};

const sinLogo = vi.fn(async () => new Response("no", { status: 404 }));

describe("cargarPdfRecibo", () => {
  it("da 404 sin consultar si el id no es un uuid", async () => {
    const { cliente, consultas } = clienteStub(BASE);
    const r = await cargarPdfRecibo({ id: "x", url: URL_PEDIDO, cliente, fetch: sinLogo });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(404);
    expect(consultas).toHaveLength(0);
  });

  it("da 404 si el recibo no existe", async () => {
    const { cliente } = clienteStub({ ...BASE, recibo: { data: null, error: null } });
    const r = await cargarPdfRecibo({ id: ID, url: URL_PEDIDO, cliente, fetch: sinLogo });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(404);
  });

  it("da 409 para un borrador, sin leer el resto", async () => {
    const { cliente, consultas } = clienteStub({
      ...BASE,
      recibo: { data: { ...RECIBO_EJEMPLO, estado: "borrador", cliente_id: "c1" }, error: null },
    });
    const r = await cargarPdfRecibo({ id: ID, url: URL_PEDIDO, cliente, fetch: sinLogo });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(409);
    expect(await r.respuesta.text()).toBe("Un recibo en borrador no se imprime: emitilo primero.");
    expect(consultas.map((c) => c.tabla)).toEqual(["recibo"]);
  });

  it("da 500 con el mensaje si falla una consulta", async () => {
    const { cliente } = clienteStub({ ...BASE, recibo_medio: { data: null, error: { message: "sin permiso" } } });
    const r = await cargarPdfRecibo({ id: ID, url: URL_PEDIDO, cliente, fetch: sinLogo });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(500);
    expect(await r.respuesta.text()).toContain("sin permiso");
  });

  it("arma los datos con columnas explícitas (nunca *) y sin logo si no llega", async () => {
    const { cliente, consultas } = clienteStub(BASE);
    const r = await cargarPdfRecibo({ id: ID, url: URL_PEDIDO, cliente, fetch: sinLogo });
    if (!r.ok) throw new Error("esperaba datos");
    expect(r.logo).toBeNull();
    expect(r.datos.nombreArchivo).toBe("Recibo R-00001-00000042");
    expect(r.datos.imputaciones).toHaveLength(2);
    for (const c of consultas) expect(c.columnas).not.toContain("*");
    expect(consultas.map((c) => c.tabla).sort()).toEqual(["arca_emisor", "cliente", "imputacion", "recibo", "recibo_medio"]);
  });
});
