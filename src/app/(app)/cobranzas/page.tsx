import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import { filtroBusquedaClientes } from "@/lib/clientes/busqueda";
import { NOMBRES_ESTADO_RECIBO, TONO_ESTADO_RECIBO, leerFiltrosCobranzas } from "@/lib/cobranzas/listado";
import { ESTADOS_RECIBO, type Recibo } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Tope de filas: el listado no pagina todavía. */
const LIMITE = 500;

type Fila = Pick<
  Recibo,
  "id" | "fecha" | "numero_texto" | "estado" | "total" | "comprobante_contado_id" | "creado_en"
> & { cliente: { razon_social: string } | null };

export default async function CobranzasPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltrosCobranzas(await searchParams);
  const supabase = await createClient();

  const busqueda = filtroBusquedaClientes(filtros.cliente);
  let consulta = supabase
    .from("recibo")
    .select(
      `id, fecha, numero_texto, estado, total, comprobante_contado_id, creado_en, cliente${busqueda ? "!inner" : ""}(razon_social)`,
    )
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false })
    .limit(LIMITE);
  if (busqueda) consulta = consulta.or(busqueda, { referencedTable: "cliente" });
  if (filtros.desde) consulta = consulta.gte("fecha", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("fecha", filtros.hasta);
  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);

  const { data, error } = await consulta;
  if (error) return <p className="text-sm text-red-700">Error al cargar las cobranzas: {error.message}</p>;
  const filas = (data ?? []) as unknown as Fila[];
  const hayFiltros = Boolean(filtros.desde || filtros.hasta || filtros.cliente || filtros.estado);

  return (
    <>
      <Encabezado
        titulo="Cobranzas"
        descripcion="Recibos de cobranza de cuenta corriente y pagos de facturas de contado. Un recibo emitido no se modifica."
        acciones={
          <Link href="/cobranzas/nueva" className="boton-primario">
            + Nueva cobranza
          </Link>
        }
      />

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
        <div className="sm:col-span-5">
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
        <div className="sm:col-span-3">
          <label className="etiqueta" htmlFor="filtro-estado">
            Estado
          </label>
          <select id="filtro-estado" name="estado" defaultValue={filtros.estado} className="campo">
            <option value="">Todos</option>
            {ESTADOS_RECIBO.map((e) => (
              <option key={e} value={e}>
                {NOMBRES_ESTADO_RECIBO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-12">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/cobranzas" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${filas.length} recibos`}
        descripcion={filas.length >= LIMITE ? `Se muestran los ${LIMITE} más recientes: acotá con los filtros.` : undefined}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Número</th>
                <th>Cliente</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <Vacio
                  mensaje={hayFiltros ? "Ningún recibo coincide con los filtros." : "Todavía no hay cobranzas."}
                  colSpan={5}
                />
              )}
              {filas.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{fecha(r.fecha)}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    <Link href={`/cobranzas/${r.id}`} className="font-medium text-marca-700 hover:underline">
                      {r.numero_texto ?? "—"}
                    </Link>
                  </td>
                  <td>{r.cliente?.razon_social ?? "—"}</td>
                  <td className="text-right tabular-nums">{pesos(Number(r.total))}</td>
                  <td>
                    <span className="flex flex-wrap items-center gap-1">
                      <Pastilla tono={TONO_ESTADO_RECIBO[r.estado]}>{NOMBRES_ESTADO_RECIBO[r.estado]}</Pastilla>
                      {r.comprobante_contado_id && <Pastilla tono="azul">Contado</Pastilla>}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}
