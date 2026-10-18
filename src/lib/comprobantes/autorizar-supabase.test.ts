import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { ErrorBaseDatos } from "./autorizar";
import { repositorioComprobantes } from "./autorizar-supabase";

/**
 * Cliente de Supabase falso: cada `from(tabla)` arma una consulta encadenable
 * que registra sus pasos (select, eq, in, ...) y, al esperarla, responde
 * `responder(consulta)`. Así se ven los filtros que manda el repositorio.
 */
type Paso = [string, ...unknown[]];
type Consulta = { tabla: string; pasos: Paso[] };
type Respuesta = { data: unknown; error: { code?: string; message: string } | null };

function supabaseFalso(responder: (c: Consulta) => Respuesta) {
  const consultas: Consulta[] = [];
  const cliente = {
    from(tabla: string) {
      const consulta: Consulta = { tabla, pasos: [] };
      consultas.push(consulta);
      const builder: Record<string, unknown> = {};
      for (const metodo of ["select", "eq", "in", "order", "update", "maybeSingle", "single"]) {
        builder[metodo] = (...args: unknown[]) => {
          consulta.pasos.push([metodo, ...args]);
          return builder;
        };
      }
      builder.then = (resolver: (r: Respuesta) => unknown, rechazar: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => responder(consulta))
          .then(resolver, rechazar);
      return builder;
    },
  };
  const repositorio = repositorioComprobantes(cliente as unknown as Parameters<typeof repositorioComprobantes>[0]);
  return { repositorio, consultas };
}

const paso = (c: Consulta, metodo: string) => c.pasos.find((p) => p[0] === metodo);
const ok = (data: unknown): Respuesta => ({ data, error: null });

const ID = "a0000000-0000-0000-0000-000000000001";
const FACTURA = "f0000000-0000-0000-0000-000000000001";
const NC_AUTORIZADA = "n0000000-0000-0000-0000-000000000001";
const NC_VERIFICANDO = "n0000000-0000-0000-0000-000000000002";
const NC_BORRADOR = "n0000000-0000-0000-0000-000000000003";
const CUIT_EMISOR = "23334771229";

const relacionado = (id: string, clase: string, estado: string, total: number, numero: number | null) => ({
  id,
  estado,
  clase,
  letra: "A",
  tipo_arca: clase === "factura" ? 1 : 3,
  punto_venta: 7,
  numero,
  fecha: "2026-10-10",
  total,
  ambiente: "homologacion",
});

const COMPROBANTES: Record<string, ReturnType<typeof relacionado>> = {
  [FACTURA]: relacionado(FACTURA, "factura", "autorizado", 1210, 361),
  [NC_AUTORIZADA]: relacionado(NC_AUTORIZADA, "nota_credito", "autorizado", 200, 5),
  [NC_VERIFICANDO]: relacionado(NC_VERIFICANDO, "nota_credito", "verificando", 100, null),
  [NC_BORRADOR]: relacionado(NC_BORRADOR, "nota_credito", "borrador", 50, null),
};

const MANUAL = { asociado_id: null, tipo_arca: 6, punto_venta: 3, numero: 150, fecha: "2026-01-09", cuit: "30712345671" };
const INTERNO = { asociado_id: FACTURA, tipo_arca: null, punto_venta: null, numero: null, fecha: null, cuit: null };

/** Base de prueba: la nota `ID` de clase `clase` con `filasAsociado`. */
function base(opciones: {
  clase?: string;
  filasAsociado?: unknown[];
  notasSobre?: { comprobante_id: string }[];
  errorAsociados?: string;
  cabecera?: Record<string, unknown>;
  items?: unknown[];
}) {
  return (c: Consulta): Respuesta => {
    switch (c.tabla) {
      case "comprobante": {
        if (paso(c, "maybeSingle")) {
          return ok({
            id: ID,
            estado: "borrador",
            punto_venta: 7,
            ambiente: "homologacion",
            clase: opciones.clase ?? "nota_credito",
            letra: null,
            tipo_arca: null,
            fecha: "2026-10-16",
            total: 0,
            receptor_doc_nro: null,
            intento_numero: null,
            cliente_id: "c1",
            periodo_asoc_desde: null,
            periodo_asoc_hasta: null,
            ...opciones.cabecera,
          });
        }
        const ids = (paso(c, "in")?.[2] ?? []) as string[];
        return ok(ids.map((id) => COMPROBANTES[id]).filter(Boolean));
      }
      case "comprobante_asociado":
        if (opciones.errorAsociados) return { data: null, error: { message: opciones.errorAsociados } };
        if (paso(c, "eq")) return ok(opciones.filasAsociado ?? []);
        return ok(opciones.notasSobre ?? []);
      case "comprobante_item":
        return ok(opciones.items ?? []);
      case "cliente":
        return ok({
          razon_social: "Frutícola S.A.",
          cuit: "20111111112",
          condicion_iva: "Responsable Inscripto",
          direccion: null,
          localidad: null,
          provincia: null,
        });
      case "punto_venta":
        return ok({ electronico: true });
      case "arca_emisor":
        return ok({ cuit: CUIT_EMISOR });
      case "arca_credencial":
        return ok(null);
      default:
        throw new Error(`tabla no esperada: ${c.tabla}`);
    }
  };
}

// Notas que asocian la factura: ésta (se excluye), una repetida y una en borrador.
const NOTAS_SOBRE = [
  { comprobante_id: ID },
  { comprobante_id: NC_AUTORIZADA },
  { comprobante_id: NC_AUTORIZADA },
  { comprobante_id: NC_VERIFICANDO },
  { comprobante_id: NC_BORRADOR },
];

describe("repositorioComprobantes: no gravados y período al cargar", () => {
  it("lee los ítems no gravados y el período asociado de la nota", async () => {
    const { repositorio } = supabaseFalso(
      base({
        clase: "nota_debito",
        cabecera: { periodo_asoc_desde: "2026-10-01", periodo_asoc_hasta: "2026-10-15" },
        items: [
          { id: "i1", cantidad: 1, precio_unitario: 1000, descuento_pct: 0, gravado: false, alicuota_iva: null, importe: 1000, iva: 0 },
          { id: "i2", cantidad: 1, precio_unitario: 100, descuento_pct: 0, gravado: true, alicuota_iva: 21, importe: 100, iva: 21 },
        ],
      }),
    );
    const datos = await repositorio.cargar(ID);
    expect(datos?.periodo).toEqual({ desde: "2026-10-01", hasta: "2026-10-15" });
    expect(datos?.items.map((i) => i.alicuotaIva)).toEqual(["no_gravado", 21]);
  });

  it("sin período, periodo es null", async () => {
    const { repositorio } = supabaseFalso(base({ clase: "factura" }));
    expect((await repositorio.cargar(ID))?.periodo).toBeNull();
  });
});

describe("repositorioComprobantes: asociados al cargar", () => {
  it("arma los CbtesAsoc de la base y los cargados a mano, y el saldo sin contar la nota que se autoriza", async () => {
    const { repositorio, consultas } = supabaseFalso(
      base({ filasAsociado: [INTERNO, MANUAL], notasSobre: NOTAS_SOBRE }),
    );
    const datos = await repositorio.cargar(ID);

    expect(datos?.asociados).toEqual([
      { tipo: 1, puntoVenta: 7, numero: 361, fecha: "2026-10-10", cuit: CUIT_EMISOR },
      { tipo: 6, puntoVenta: 3, numero: 150, fecha: "2026-01-09", cuit: "30712345671" },
    ]);
    // 1.210 de la factura menos la autorizada (200) y la que se verifica (100); el borrador no cuenta.
    expect(datos?.saldoNotaCredito).toEqual({ saldo: 910, asociado: "A-00007-00000361" });

    const asociadosDeLaNota = consultas.find((c) => c.tabla === "comprobante_asociado" && paso(c, "eq"));
    expect(paso(asociadosDeLaNota!, "eq")).toEqual(["eq", "comprobante_id", ID]);
    const notas = consultas.find((c) => c.tabla === "comprobante_asociado" && !paso(c, "eq"));
    expect(paso(notas!, "in")).toEqual(["in", "asociado_id", [FACTURA]]);
    // La nota que se autoriza no se descuenta a sí misma, y cada nota se pide una vez.
    const lecturaNotas = consultas.filter((c) => c.tabla === "comprobante" && paso(c, "in")).at(-1)!;
    expect(paso(lecturaNotas, "in")).toEqual(["in", "id", [NC_AUTORIZADA, NC_VERIFICANDO, NC_BORRADOR]]);
  });

  it("una nota de débito no lee las notas sobre el asociado ni calcula saldo", async () => {
    const { repositorio, consultas } = supabaseFalso(base({ clase: "nota_debito", filasAsociado: [INTERNO] }));
    const datos = await repositorio.cargar(ID);
    expect(datos?.saldoNotaCredito).toBeNull();
    expect(consultas.filter((c) => c.tabla === "comprobante_asociado")).toHaveLength(1);
  });

  it("con sólo un asociado cargado a mano no hay saldo (no se conoce su importe)", async () => {
    const { repositorio, consultas } = supabaseFalso(base({ filasAsociado: [MANUAL] }));
    const datos = await repositorio.cargar(ID);
    expect(datos?.saldoNotaCredito).toBeNull();
    expect(consultas.filter((c) => c.tabla === "comprobante_asociado")).toHaveLength(1);
  });

  it("falla con un mensaje legible si el asociado de la base ya no existe", async () => {
    const { repositorio } = supabaseFalso(
      base({ filasAsociado: [{ ...INTERNO, asociado_id: "f0000000-0000-0000-0000-00000000dead" }] }),
    );
    await expect(repositorio.cargar(ID)).rejects.toThrow("El comprobante asociado ya no existe.");
  });

  it("un error al leer los asociados llega como error de la base", async () => {
    const { repositorio } = supabaseFalso(base({ errorAsociados: "permiso denegado" }));
    const error = await repositorio.cargar(ID).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorBaseDatos);
    expect((error as Error).message).toBe("No se pudieron leer los comprobantes asociados: permiso denegado");
  });
});

describe("repositorioComprobantes: saldo bajo el bloqueo", () => {
  it("vuelve a leer asociados y notas, sin contar la nota que se autoriza", async () => {
    const { repositorio, consultas } = supabaseFalso(base({ filasAsociado: [INTERNO], notasSobre: NOTAS_SOBRE }));
    expect(await repositorio.saldoNotaCredito(ID)).toEqual({ saldo: 910, asociado: "A-00007-00000361" });
    const lecturaNotas = consultas.filter((c) => c.tabla === "comprobante" && paso(c, "in")).at(-1)!;
    expect(paso(lecturaNotas, "in")?.[2]).not.toContain(ID);
  });

  it("sin asociados de la base devuelve null sin buscar notas", async () => {
    const { repositorio, consultas } = supabaseFalso(base({ filasAsociado: [MANUAL] }));
    expect(await repositorio.saldoNotaCredito(ID)).toBeNull();
    expect(consultas.map((c) => c.tabla)).toEqual(["comprobante_asociado"]);
  });
});
