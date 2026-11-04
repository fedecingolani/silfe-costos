import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { EMISOR_EJEMPLO, EMPRESA_EJEMPLO } from "@/lib/comprobantes/pdf-fixtures";
import { cargarPdfRemito } from "./pdf-descarga";
import { CLIENTE_REMITO_EJEMPLO, ITEM_REMITO_EJEMPLO, REMITO_EJEMPLO } from "./pdf-fixtures";

const ID = REMITO_EJEMPLO.id;

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
  remito: { data: { ...REMITO_EJEMPLO, cliente_id: "c1", transporte_id: "t1" }, error: null },
  remito_item: { data: [ITEM_REMITO_EJEMPLO], error: null },
  cliente: { data: CLIENTE_REMITO_EJEMPLO, error: null },
  transporte: { data: { nombre: "Expreso Alto Valle" }, error: null },
  arca_emisor: { data: EMISOR_EJEMPLO, error: null },
};

describe("cargarPdfRemito", () => {
  it("da 404 sin consultar si el id no es un uuid", async () => {
    const { cliente, consultas } = clienteStub(BASE);
    const r = await cargarPdfRemito({ id: "x", cliente });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(404);
    expect(consultas).toHaveLength(0);
  });

  it("da 404 si el remito no existe", async () => {
    const { cliente } = clienteStub({ ...BASE, remito: { data: null, error: null } });
    const r = await cargarPdfRemito({ id: ID, cliente });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(404);
  });

  it("da 409 para un borrador, sin leer el resto", async () => {
    const { cliente, consultas } = clienteStub({
      ...BASE,
      remito: { data: { ...REMITO_EJEMPLO, estado: "borrador", numero: null, cliente_id: "c1" }, error: null },
    });
    const r = await cargarPdfRemito({ id: ID, cliente });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(409);
    expect(await r.respuesta.text()).toBe("Un remito en borrador no se imprime: emitilo primero.");
    expect(consultas.map((c) => c.tabla)).toEqual(["remito"]);
  });

  it("da 500 con el mensaje si falla una consulta", async () => {
    const { cliente } = clienteStub({ ...BASE, remito_item: { data: null, error: { message: "sin permiso" } } });
    const r = await cargarPdfRemito({ id: ID, cliente });
    if (r.ok) throw new Error("esperaba error");
    expect(r.respuesta.status).toBe(500);
    expect(await r.respuesta.text()).toContain("sin permiso");
  });

  it("arma los datos con columnas explícitas (nunca *), con el transporte y los bultos", async () => {
    const { cliente, consultas } = clienteStub(BASE);
    const r = await cargarPdfRemito({ id: ID, cliente });
    if (!r.ok) throw new Error("esperaba datos");
    expect(r.logo).toBeNull();
    expect(r.datos.nombreArchivo).toBe("Remito R-00001-00000001");
    expect(r.datos.entrega.transporte).toBe("Expreso Alto Valle");
    expect(r.datos.items[0].bultos).toBe("12");
    for (const c of consultas) expect(c.columnas).not.toContain("*");
    expect(consultas.find((c) => c.tabla === "remito_item")?.columnas).toContain("bultos");
    expect(consultas.map((c) => c.tabla).sort()).toEqual([
      "arca_emisor",
      "cliente",
      "empresa",
      "remito",
      "remito_item",
      "transporte",
    ]);
  });

  it("sin transporte no lo consulta", async () => {
    const { cliente, consultas } = clienteStub({
      ...BASE,
      remito: { data: { ...REMITO_EJEMPLO, cliente_id: "c1", transporte_id: null }, error: null },
    });
    const r = await cargarPdfRemito({ id: ID, cliente });
    if (!r.ok) throw new Error("esperaba datos");
    expect(r.datos.entrega.transporte).toBe("—");
    expect(consultas.map((c) => c.tabla)).not.toContain("transporte");
  });

  it("lee la identidad de la empresa", async () => {
    const { cliente } = clienteStub({ ...BASE, empresa: { data: EMPRESA_EJEMPLO, error: null } });
    const r = await cargarPdfRemito({ id: ID, cliente });
    if (!r.ok) throw new Error("esperaba datos");
    expect(r.datos.emisor.nombreFantasia).toBe("SIL - FE");
  });
});
