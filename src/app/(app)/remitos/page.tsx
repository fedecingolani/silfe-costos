import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, numero, pesos } from "@/lib/formato";
import { filtroBusquedaClientes } from "@/lib/clientes/busqueda";
import { enLotes } from "@/lib/cobranzas/estado-pago";
import { NOMBRES_ESTADO_REMITO, TONO_ESTADO_REMITO, consultaFiltros, leerFiltros } from "@/lib/remitos/listado";
import { numeroVisibleRemito } from "@/lib/remitos/numero";
import { ESTADOS_REMITO, type RemitoEstado } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Tope de filas: el listado no pagina todavía. */
const LIMITE = 500;

type Fila = Pick<RemitoEstado, "remito_id" | "punto_venta" | "numero" | "fecha" | "estado"> & {
  cliente: { razon_social: string } | null;
};

export default async function RemitosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltros(await searchParams);
  const supabase = await createClient();

  // El estado es el derivado (v_remito_estado): parcial y facturado salen de
  // lo facturado. El cliente se busca con la misma lógica que el listado de
  // clientes; el inner join deja sólo los remitos de los clientes que coinciden.
  const busqueda = filtroBusquedaClientes(filtros.cliente);
  let consulta = supabase
    .from("v_remito_estado")
    .select(`remito_id, punto_venta, numero, fecha, estado, cliente${busqueda ? "!inner" : ""}(razon_social)`)
    .order("fecha", { ascending: false })
    .order("punto_venta", { ascending: true })
    .order("numero", { ascending: false, nullsFirst: true })
    .limit(LIMITE);
  if (busqueda) consulta = consulta.or(busqueda, { referencedTable: "cliente" });
  if (filtros.desde) consulta = consulta.gte("fecha", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("fecha", filtros.hasta);
  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);
  if (filtros.puntoVenta !== null) consulta = consulta.eq("punto_venta", filtros.puntoVenta);

  const [{ data, error }, { data: puntosData, error: errorPuntos }] = await Promise.all([
    consulta,
    supabase.from("punto_venta").select("numero").order("numero"),
  ]);
  const errorCarga = error ?? errorPuntos;
  if (errorCarga) return <p className="text-sm text-red-700">Error al cargar los remitos: {errorCarga.message}</p>;
  const filas = (data ?? []) as unknown as Fila[];
  const puntos = (puntosData ?? []).map((p) => Number(p.numero));

  // Bultos y valor declarado no están en la vista: se leen del remito, en
  // lotes para no alargar la URL.
  const lotes = await Promise.all(
    enLotes(
      filas.map((f) => f.remito_id),
      100,
    ).map((lote) => supabase.from("remito").select("id, bultos_total, valor_declarado").in("id", lote)),
  );
  const errorRemitos = lotes.find((l) => l.error)?.error;
  if (errorRemitos) return <p className="text-sm text-red-700">Error al cargar los remitos: {errorRemitos.message}</p>;
  const datosRemito = new Map(
    lotes
      .flatMap((l) => l.data ?? [])
      .map((r) => [r.id as string, { bultos: Number(r.bultos_total), valor: Number(r.valor_declarado) }]),
  );
  const hayFiltros = consultaFiltros(filtros) !== "";

  return (
    <>
      <Encabezado
        titulo="Remitos"
        descripcion="Remitos de venta. Los borradores y los emitidos sin facturar se editan; después se facturan desde acá."
        acciones={
          <div className="flex gap-2">
            <Link href="/remitos/facturar" className="boton-secundario">
              Facturar remitos
            </Link>
            <Link href="/remitos/nuevo" className="boton-primario">
              + Nuevo remito
            </Link>
          </div>
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
        <div className="sm:col-span-4">
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
          <label className="etiqueta" htmlFor="filtro-estado">
            Estado
          </label>
          <select id="filtro-estado" name="estado" defaultValue={filtros.estado} className="campo">
            <option value="">Todos</option>
            {ESTADOS_REMITO.map((e) => (
              <option key={e} value={e}>
                {NOMBRES_ESTADO_REMITO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-punto-venta">
            Punto de venta
          </label>
          <select
            id="filtro-punto-venta"
            name="punto_venta"
            defaultValue={filtros.puntoVenta === null ? "" : String(filtros.puntoVenta)}
            className="campo"
          >
            <option value="">Todos</option>
            {puntos.map((n) => (
              <option key={n} value={String(n)}>
                {String(n).padStart(5, "0")}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-12">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/remitos" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${filas.length} ${filas.length === 1 ? "remito" : "remitos"}`}
        descripcion={filas.length >= LIMITE ? `Se muestran los ${LIMITE} más recientes: acotá con los filtros.` : undefined}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Punto de venta</th>
                <th className="text-right">Bultos</th>
                <th className="text-right">Valor declarado</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <Vacio
                  mensaje={hayFiltros ? "Ningún remito coincide con los filtros." : "Todavía no hay remitos."}
                  colSpan={7}
                />
              )}
              {filas.map((r) => {
                const extra = datosRemito.get(r.remito_id);
                return (
                  <tr key={r.remito_id}>
                    <td className="whitespace-nowrap tabular-nums">
                      <Link href={`/remitos/${r.remito_id}`} className="font-medium text-marca-700 hover:underline">
                        {numeroVisibleRemito({ punto_venta: Number(r.punto_venta), numero: r.numero })}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap">{fecha(r.fecha)}</td>
                    <td>{r.cliente?.razon_social ?? "—"}</td>
                    <td className="tabular-nums">{String(r.punto_venta).padStart(5, "0")}</td>
                    <td className="text-right tabular-nums">{extra ? numero(extra.bultos, 0) : "—"}</td>
                    <td className="text-right tabular-nums">{extra ? pesos(extra.valor) : "—"}</td>
                    <td>
                      <Pastilla tono={TONO_ESTADO_REMITO[r.estado]}>{NOMBRES_ESTADO_REMITO[r.estado]}</Pastilla>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}
