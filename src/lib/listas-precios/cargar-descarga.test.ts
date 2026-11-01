import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cargarDatosDescarga, respuestaArchivo } from "./cargar-descarga";
import { esUuid } from "./uuid";
import { PNG_1X1, PNG_1X1_BASE64 } from "@/lib/empresa/logo-fixtures";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

type Respuesta = { data: unknown; error: { message: string } | null };

/** Cliente de Supabase mínimo: cada tabla devuelve una respuesta fija y registra las consultas. */
function clienteStub(respuestas: Record<string, Respuesta>) {
  const consultas: string[] = [];
  const cliente = {
    from(tabla: string) {
      consultas.push(tabla);
      const respuesta = respuestas[tabla] ?? { data: null, error: null };
      const constructor = {
        select: () => constructor,
        eq: () => constructor,
        order: () => Promise.resolve(respuesta),
        maybeSingle: () => Promise.resolve(respuesta),
      };
      return constructor;
    },
  };
  return { cliente: cliente as unknown as SupabaseClient, consultas };
}

const lista = {
  id: ID,
  nombre: "Diciembre 2023",
  titulo: "LISTA DE PRECIOS DICIEMBRE 2023",
  notas: null,
  creado_en: "2023-12-01T12:00:00+00:00",
  creado_por: null,
};

const item = {
  id: "i1",
  lista_id: ID,
  orden: 1,
  es_repuesto: false,
  producto_id: null,
  codigo: "001",
  descripcion: "Recolector",
  presentacion: null,
  alicuota_iva: 21,
  precio_sugerido: null,
  precio_final: 100,
};

const parametros = { lista_texto_destacado: "EJEMPLO – 30 AÑOS", lista_contacto: "Ventas" };

function respuestasOk(cambios: Record<string, Respuesta> = {}) {
  return {
    lista_precio: { data: lista, error: null },
    lista_precio_item: { data: [item], error: null },
    parametro_costeo: { data: parametros, error: null },
    empresa: { data: { logo_base64: PNG_1X1_BASE64, logo_tipo: "image/png" }, error: null },
    ...cambios,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("esUuid", () => {
  it("acepta un uuid y rechaza otros textos", () => {
    expect(esUuid(ID)).toBe(true);
    expect(esUuid(ID.toUpperCase())).toBe(true);
    expect(esUuid("123")).toBe(false);
    expect(esUuid(`${ID}x`)).toBe(false);
    expect(esUuid(undefined)).toBe(false);
  });
});

describe("cargarDatosDescarga", () => {
  it("arma los datos de la lista con el pie, la fecha de creación y el logo", async () => {
    const { cliente } = clienteStub(respuestasOk());
    const resultado = await cargarDatosDescarga({ id: ID, conLogo: true, cliente });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) return;
    expect(resultado.nombre).toBe("Diciembre 2023");
    expect(resultado.datos).toMatchObject({
      titulo: "LISTA DE PRECIOS DICIEMBRE 2023",
      textoDestacado: "EJEMPLO – 30 AÑOS",
      contacto: "Ventas",
      creadoEn: "2023-12-01T12:00:00+00:00",
    });
    expect(resultado.datos.items).toHaveLength(1);
    expect(resultado.datos.logo).toEqual(PNG_1X1);
  });

  it("usa el nombre como título si la lista no tiene título", async () => {
    const { cliente } = clienteStub(respuestasOk({ lista_precio: { data: { ...lista, titulo: null }, error: null } }));
    const resultado = await cargarDatosDescarga({ id: ID, conLogo: false, cliente });
    expect(resultado.ok && resultado.datos.titulo).toBe("Diciembre 2023");
  });

  it("no lee el logo si no hace falta", async () => {
    const { cliente, consultas } = clienteStub(respuestasOk());
    const resultado = await cargarDatosDescarga({ id: ID, conLogo: false, cliente });
    expect(consultas).not.toContain("empresa");
    expect(resultado.ok && resultado.datos.logo).toBeNull();
  });

  it("da 404 si la lista no existe", async () => {
    const { cliente } = clienteStub(respuestasOk({ lista_precio: { data: null, error: null } }));
    const resultado = await cargarDatosDescarga({ id: ID, conLogo: false, cliente });
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(resultado.respuesta.status).toBe(404);
    expect(await resultado.respuesta.text()).toBe("La lista de precios no existe.");
  });

  it("da 404 sin consultar si el id no es un uuid", async () => {
    const { cliente, consultas } = clienteStub(respuestasOk());
    const resultado = await cargarDatosDescarga({ id: "no-es-uuid", conLogo: true, cliente });
    expect(!resultado.ok && resultado.respuesta.status).toBe(404);
    expect(consultas).toEqual([]);
  });

  it.each(["lista_precio", "lista_precio_item", "parametro_costeo"])(
    "da 500 con el detalle si falla la consulta de %s",
    async (tabla) => {
      const { cliente } = clienteStub(respuestasOk({ [tabla]: { data: null, error: { message: "fallo de red" } } }));
      const resultado = await cargarDatosDescarga({ id: ID, conLogo: false, cliente });
      expect(resultado.ok).toBe(false);
      if (resultado.ok) return;
      expect(resultado.respuesta.status).toBe(500);
      expect(resultado.respuesta.headers.get("Cache-Control")).toBe("no-store");
      expect(await resultado.respuesta.text()).toMatch(/^Error al cargar .*: fallo de red$/);
    },
  );

  it("sale sin logo si no hay logo cargado", async () => {
    const { cliente } = clienteStub(respuestasOk({ empresa: { data: { logo_base64: null, logo_tipo: null }, error: null } }));
    const resultado = await cargarDatosDescarga({ id: ID, conLogo: true, cliente });
    expect(resultado.ok && resultado.datos.logo).toBeNull();
    expect(resultado.ok && resultado.datos.items).toHaveLength(1);
  });

  it("sale sin logo si falla la lectura del logo", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { cliente } = clienteStub(respuestasOk({ empresa: { data: null, error: { message: "fallo de red" } } }));
    const resultado = await cargarDatosDescarga({ id: ID, conLogo: true, cliente });
    expect(resultado.ok && resultado.datos.logo).toBeNull();
    expect(aviso).toHaveBeenCalled();
  });
});

describe("respuestaArchivo", () => {
  it("arma la descarga con el tipo, el nombre del archivo y sin caché", async () => {
    const respuesta = respuestaArchivo(new Uint8Array([37, 80, 68, 70]), "Lista Año 1", "pdf", "application/pdf");
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("application/pdf");
    expect(respuesta.headers.get("Content-Disposition")).toBe(
      "attachment; filename=\"lista-ano-1.pdf\"; filename*=UTF-8''Lista%20A%C3%B1o%201.pdf",
    );
    expect(respuesta.headers.get("Cache-Control")).toBe("private, no-store");
    expect(new Uint8Array(await respuesta.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });
});
