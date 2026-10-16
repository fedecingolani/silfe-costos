import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import { filtroBusquedaClientes } from "@/lib/clientes/busqueda";
import {
  NOMBRES_ESTADO,
  TONO_ESTADO,
  leerFiltros,
  nombreComprobante,
  numeroVisible,
  ordenarListado,
} from "@/lib/comprobantes/listado";
import {
  AMBIENTES_ARCA,
  CLASES_COMPROBANTE,
  ESTADOS_COMPROBANTE,
  NOMBRES_AMBIENTE_ARCA,
  NOMBRES_CLASE_COMPROBANTE,
  type AmbienteArca,
  type Comprobante,
} from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Tope de filas: el listado no pagina todavía. */
const LIMITE = 500;

type Fila = Pick<
  Comprobante,
  "id" | "fecha" | "clase" | "letra" | "punto_venta" | "numero" | "estado" | "total" | "cae" | "ambiente" | "creado_en"
> & { cliente: { razon_social: string } | null };

export default async function ComprobantesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const supabase = await createClient();
  const { data: emisor, error: errorEmisor } = await supabase
    .from("arca_emisor")
    .select("ambiente")
    .eq("id", true)
    .maybeSingle();
  if (errorEmisor) return <p className="text-sm text-red-700">Error al cargar el emisor: {errorEmisor.message}</p>;
  const ambienteActivo = (emisor?.ambiente ?? "homologacion") as AmbienteArca;
  const filtros = leerFiltros(parametros, ambienteActivo);

  // El cliente se busca con la misma lógica que el listado de clientes; el
  // inner join deja sólo los comprobantes de los clientes que coinciden.
  const busqueda = filtroBusquedaClientes(filtros.cliente);
  let consulta = supabase
    .from("comprobante")
    .select(
      `id, fecha, clase, letra, punto_venta, numero, estado, total, cae, ambiente, creado_en, cliente${busqueda ? "!inner" : ""}(razon_social)`,
    )
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false })
    .limit(LIMITE);
  if (busqueda) consulta = consulta.or(busqueda, { referencedTable: "cliente" });
  if (filtros.desde) consulta = consulta.gte("fecha", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("fecha", filtros.hasta);
  if (filtros.clase) consulta = consulta.eq("clase", filtros.clase);
  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);
  if (filtros.ambiente !== "todos") consulta = consulta.eq("ambiente", filtros.ambiente);

  const { data, error } = await consulta;
  if (error) return <p className="text-sm text-red-700">Error al cargar los comprobantes: {error.message}</p>;
  const filas = ordenarListado((data ?? []) as unknown as Fila[]);
  const hayFiltros =
    Boolean(filtros.desde || filtros.hasta || filtros.cliente || filtros.clase || filtros.estado) ||
    filtros.ambiente !== ambienteActivo;

  return (
    <>
      <Encabezado
        titulo="Comprobantes"
        descripcion="Facturas y notas de débito y crédito. Los borradores se editan; los autorizados en ARCA no se modifican más."
        acciones={
          <Link href="/comprobantes/nuevo" className="boton-primario">
            + Nuevo comprobante
          </Link>
        }
      />

      {ambienteActivo === "homologacion" && (
        <div role="status" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Homologación: los comprobantes no tienen validez fiscal.
        </div>
      )}

      <form method="get" className="tarjeta mb-4 grid gap-3 p-4 sm:grid-cols-12">
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-desde">
            Desde
          </label>
          <input id="filtro-desde" name="desde" type="date" defaultValue={filtros.desde} className="campo" />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-hasta">
            Hasta
          </label>
          <input id="filtro-hasta" name="hasta" type="date" defaultValue={filtros.hasta} className="campo" />
        </div>
        <div className="sm:col-span-3">
          <label className="etiqueta" htmlFor="filtro-cliente">
            Cliente
          </label>
          <input
            id="filtro-cliente"
            name="cliente"
            type="search"
            defaultValue={filtros.cliente}
            placeholder="Razón social, CUIT o código"
            className="campo"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-clase">
            Tipo
          </label>
          <select id="filtro-clase" name="clase" defaultValue={filtros.clase} className="campo">
            <option value="">Todos</option>
            {CLASES_COMPROBANTE.map((c) => (
              <option key={c} value={c}>
                {NOMBRES_CLASE_COMPROBANTE[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-1">
          <label className="etiqueta" htmlFor="filtro-estado">
            Estado
          </label>
          <select id="filtro-estado" name="estado" defaultValue={filtros.estado} className="campo">
            <option value="">Todos</option>
            {ESTADOS_COMPROBANTE.map((e) => (
              <option key={e} value={e}>
                {NOMBRES_ESTADO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-ambiente">
            Ambiente
          </label>
          <select id="filtro-ambiente" name="ambiente" defaultValue={filtros.ambiente} className="campo">
            {AMBIENTES_ARCA.map((a) => (
              <option key={a} value={a}>
                {NOMBRES_AMBIENTE_ARCA[a]}
              </option>
            ))}
            <option value="todos">Todos</option>
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-12">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/comprobantes" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${filas.length} comprobantes`}
        descripcion={filas.length >= LIMITE ? `Se muestran los ${LIMITE} más recientes: acotá con los filtros.` : undefined}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Comprobante</th>
                <th>Número</th>
                <th>Cliente</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
                <th>CAE</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <Vacio
                  mensaje={hayFiltros ? "Ningún comprobante coincide con los filtros." : "Todavía no hay comprobantes."}
                  colSpan={7}
                />
              )}
              {filas.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{fecha(c.fecha)}</td>
                  <td>
                    <Link href={`/comprobantes/${c.id}`} className="font-medium text-marca-700 hover:underline">
                      {nombreComprobante(c.clase, c.letra)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap tabular-nums">{numeroVisible(c)}</td>
                  <td>{c.cliente?.razon_social ?? "—"}</td>
                  <td className="text-right tabular-nums">{pesos(Number(c.total))}</td>
                  <td>
                    <Pastilla tono={TONO_ESTADO[c.estado]}>{NOMBRES_ESTADO[c.estado]}</Pastilla>
                  </td>
                  <td className="tabular-nums">{c.cae ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}
