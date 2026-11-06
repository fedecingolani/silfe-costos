import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import { NOMBRES_ESTADO_ORDEN_PAGO, TONO_ESTADO_ORDEN_PAGO, leerFiltrosPagos } from "@/lib/compras/pagos/listado";
import { ESTADOS_ORDEN_PAGO, type OrdenPago } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Tope de filas: el listado no pagina todavía. */
const LIMITE = 500;

type Fila = Pick<OrdenPago, "id" | "fecha" | "numero_texto" | "estado" | "total" | "creado_en"> & {
  proveedor: { nombre: string } | null;
};

export default async function PagosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltrosPagos(await searchParams);
  const supabase = await createClient();

  let consulta = supabase
    .from("orden_pago")
    .select("id, fecha, numero_texto, estado, total, creado_en, proveedor(nombre)")
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false })
    .limit(LIMITE);
  if (filtros.desde) consulta = consulta.gte("fecha", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("fecha", filtros.hasta);
  if (filtros.proveedor) consulta = consulta.eq("proveedor_id", filtros.proveedor);
  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);

  const [{ data, error }, { data: proveedoresData, error: errorProveedores }] = await Promise.all([
    consulta,
    supabase.from("proveedor").select("id, nombre").order("nombre"),
  ]);
  const errorCarga = error ?? errorProveedores;
  if (errorCarga) return <p className="text-sm text-red-700">Error al cargar los pagos: {errorCarga.message}</p>;
  const filas = (data ?? []) as unknown as Fila[];
  const proveedores = (proveedoresData ?? []) as { id: string; nombre: string }[];
  const hayFiltros = Boolean(filtros.desde || filtros.hasta || filtros.proveedor || filtros.estado);

  return (
    <>
      <Encabezado
        titulo="Pagos"
        descripcion="Órdenes de pago a proveedores. Una orden confirmada no se modifica: si se cargó mal, se anula."
        acciones={
          <Link href="/compras/pagos/nuevo" className="boton-primario">
            + Nueva orden de pago
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
          <label className="etiqueta" htmlFor="filtro-proveedor">
            Proveedor
          </label>
          <select id="filtro-proveedor" name="proveedor" defaultValue={filtros.proveedor} className="campo">
            <option value="">Todos</option>
            {proveedores.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <label className="etiqueta" htmlFor="filtro-estado">
            Estado
          </label>
          <select id="filtro-estado" name="estado" defaultValue={filtros.estado} className="campo">
            <option value="">Todos</option>
            {ESTADOS_ORDEN_PAGO.map((e) => (
              <option key={e} value={e}>
                {NOMBRES_ESTADO_ORDEN_PAGO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-12">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/compras/pagos" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${filas.length} ${filas.length === 1 ? "orden de pago" : "órdenes de pago"}`}
        descripcion={filas.length >= LIMITE ? `Se muestran las ${LIMITE} más recientes: acotá con los filtros.` : undefined}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Número</th>
                <th>Proveedor</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <Vacio
                  mensaje={hayFiltros ? "Ninguna orden de pago coincide con los filtros." : "Todavía no hay órdenes de pago."}
                  colSpan={5}
                />
              )}
              {filas.map((o) => (
                <tr key={o.id}>
                  <td className="whitespace-nowrap">{fecha(o.fecha)}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    <Link href={`/compras/pagos/${o.id}`} className="font-medium text-marca-700 hover:underline">
                      {o.numero_texto ?? "Borrador"}
                    </Link>
                  </td>
                  <td>{o.proveedor?.nombre ?? "—"}</td>
                  <td className="text-right tabular-nums">{pesos(Number(o.total))}</td>
                  <td>
                    <Pastilla tono={TONO_ESTADO_ORDEN_PAGO[o.estado]}>{NOMBRES_ESTADO_ORDEN_PAGO[o.estado]}</Pastilla>
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
