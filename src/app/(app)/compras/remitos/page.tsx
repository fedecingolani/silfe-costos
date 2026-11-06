import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, numero } from "@/lib/formato";
import {
  ESTADOS_VISIBLES_REMITO_COMPRA,
  NOMBRES_ESTADO_REMITO_COMPRA,
  TONO_ESTADO_REMITO_COMPRA,
  condicionEstadoVisible,
  consultaFiltros,
  estadoVisibleRemitoCompra,
  leerFiltros,
  numeroRemitoCompra,
} from "@/lib/compras/remitos/listado";
import type { RemitoCompraEstado } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Tope de filas: el listado no pagina todavía. */
const LIMITE = 500;

type Fila = Pick<
  RemitoCompraEstado,
  "remito_compra_id" | "punto_venta" | "numero" | "fecha" | "estado" | "estado_facturacion" | "cantidad" | "pendiente"
> & { proveedor: { nombre: string } | null };

export default async function RemitosCompraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltros(await searchParams);
  const supabase = await createClient();

  // El estado que se muestra y se filtra es el guardado más lo facturado (v_remito_compra_estado).
  let consulta = supabase
    .from("v_remito_compra_estado")
    .select("remito_compra_id, punto_venta, numero, fecha, estado, estado_facturacion, cantidad, pendiente, proveedor(nombre)")
    .order("fecha", { ascending: false })
    .order("numero", { ascending: false })
    .limit(LIMITE);
  if (filtros.desde) consulta = consulta.gte("fecha", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("fecha", filtros.hasta);
  if (filtros.proveedor) consulta = consulta.eq("proveedor_id", filtros.proveedor);
  if (filtros.estado) {
    const condicion = condicionEstadoVisible(filtros.estado);
    consulta = consulta.eq("estado", condicion.estado);
    if (condicion.estado_facturacion) consulta = consulta.eq("estado_facturacion", condicion.estado_facturacion);
  }

  const [{ data, error }, { data: proveedoresData, error: errorProveedores }] = await Promise.all([
    consulta,
    supabase.from("proveedor").select("id, nombre").order("nombre"),
  ]);
  const errorCarga = error ?? errorProveedores;
  if (errorCarga) return <p className="text-sm text-red-700">Error al cargar los remitos: {errorCarga.message}</p>;
  const filas = (data ?? []) as unknown as Fila[];
  const proveedores = (proveedoresData ?? []) as { id: string; nombre: string }[];
  const hayFiltros = consultaFiltros(filtros) !== "";

  return (
    <>
      <Encabezado
        titulo="Remitos de compra"
        descripcion="La mercadería que entregan los proveedores. Los borradores se editan; un recibido se factura o se anula."
        acciones={
          <div className="flex gap-2">
            <Link href="/compras/remitos/facturar" className="boton-secundario">
              Facturar remitos
            </Link>
            <Link href="/compras/remitos/nuevo" className="boton-primario">
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
            {ESTADOS_VISIBLES_REMITO_COMPRA.map((e) => (
              <option key={e} value={e}>
                {NOMBRES_ESTADO_REMITO_COMPRA[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-12">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/compras/remitos" className="boton-secundario">
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
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Remito</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Pendiente de facturar</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <Vacio
                  mensaje={hayFiltros ? "Ningún remito coincide con los filtros." : "Todavía no hay remitos de compra."}
                  colSpan={6}
                />
              )}
              {filas.map((r) => {
                const estado = estadoVisibleRemitoCompra(r.estado, r.estado_facturacion);
                return (
                  <tr key={r.remito_compra_id}>
                    <td className="whitespace-nowrap">{fecha(r.fecha)}</td>
                    <td>{r.proveedor?.nombre ?? "—"}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      <Link
                        href={`/compras/remitos/${r.remito_compra_id}`}
                        className="font-medium text-marca-700 hover:underline"
                      >
                        {numeroRemitoCompra(r)}
                      </Link>
                    </td>
                    <td className="text-right tabular-nums">{numero(Number(r.cantidad), 4)}</td>
                    <td className="text-right tabular-nums">
                      {r.estado === "recibido" ? numero(Number(r.pendiente), 4) : "—"}
                    </td>
                    <td>
                      <Pastilla tono={TONO_ESTADO_REMITO_COMPRA[estado]}>{NOMBRES_ESTADO_REMITO_COMPRA[estado]}</Pastilla>
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
