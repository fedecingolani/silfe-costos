import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import {
  NOMBRES_ESTADO_COMPROBANTE_COMPRA,
  TONO_ESTADO_COMPROBANTE_COMPRA,
  consultaFiltros,
  leerFiltros,
} from "@/lib/compras/comprobantes/listado";
import { NOMBRES_TIPO_COMPROBANTE_COMPRA, numeroComprobanteCompra } from "@/lib/compras/comprobantes/numero";
import {
  ESTADOS_COMPROBANTE_COMPRA,
  TIPOS_COMPROBANTE_COMPRA,
  type ComprobanteCompra,
} from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Tope de filas: el listado no pagina todavía. */
const LIMITE = 500;

type Fila = Pick<ComprobanteCompra, "id" | "fecha" | "tipo" | "letra" | "punto_venta" | "numero" | "total" | "estado"> & {
  proveedor: { nombre: string } | null;
};

export default async function ComprobantesCompraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltros(await searchParams);
  const supabase = await createClient();

  let consulta = supabase
    .from("comprobante_compra")
    .select("id, fecha, tipo, letra, punto_venta, numero, total, estado, proveedor(nombre)")
    .order("fecha", { ascending: false })
    .order("creado_en", { ascending: false })
    .limit(LIMITE);
  if (filtros.desde) consulta = consulta.gte("fecha", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("fecha", filtros.hasta);
  if (filtros.proveedor) consulta = consulta.eq("proveedor_id", filtros.proveedor);
  if (filtros.tipo) consulta = consulta.eq("tipo", filtros.tipo);
  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);

  const [{ data, error }, { data: proveedoresData, error: errorProveedores }] = await Promise.all([
    consulta,
    supabase.from("proveedor").select("id, nombre").order("nombre"),
  ]);
  const errorCarga = error ?? errorProveedores;
  if (errorCarga) return <p className="text-sm text-red-700">Error al cargar los comprobantes: {errorCarga.message}</p>;
  const filas = (data ?? []) as unknown as Fila[];
  const proveedores = (proveedoresData ?? []) as { id: string; nombre: string }[];
  const hayFiltros = consultaFiltros(filtros) !== "";

  return (
    <>
      <Encabezado
        titulo="Comprobantes de compra"
        descripcion="Facturas, notas de crédito y notas de débito de los proveedores. Los borradores se editan; un confirmado se anula."
        acciones={
          <Link href="/compras/comprobantes/nuevo" className="boton-primario">
            + Nuevo comprobante
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
        <div className="sm:col-span-4">
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
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-tipo">
            Tipo
          </label>
          <select id="filtro-tipo" name="tipo" defaultValue={filtros.tipo} className="campo">
            <option value="">Todos</option>
            {TIPOS_COMPROBANTE_COMPRA.map((t) => (
              <option key={t} value={t}>
                {NOMBRES_TIPO_COMPROBANTE_COMPRA[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-estado">
            Estado
          </label>
          <select id="filtro-estado" name="estado" defaultValue={filtros.estado} className="campo">
            <option value="">Todos</option>
            {ESTADOS_COMPROBANTE_COMPRA.map((e) => (
              <option key={e} value={e}>
                {NOMBRES_ESTADO_COMPROBANTE_COMPRA[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-12">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/compras/comprobantes" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${filas.length} ${filas.length === 1 ? "comprobante" : "comprobantes"}`}
        descripcion={filas.length >= LIMITE ? `Se muestran los ${LIMITE} más recientes: acotá con los filtros.` : undefined}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Proveedor</th>
                <th>Comprobante</th>
                <th className="text-right">Total</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <Vacio
                  mensaje={hayFiltros ? "Ningún comprobante coincide con los filtros." : "Todavía no hay comprobantes de compra."}
                  colSpan={5}
                />
              )}
              {filas.map((c) => (
                <tr key={c.id}>
                  <td className="whitespace-nowrap">{fecha(c.fecha)}</td>
                  <td>{c.proveedor?.nombre ?? "—"}</td>
                  <td className="whitespace-nowrap tabular-nums">
                    <Link href={`/compras/comprobantes/${c.id}`} className="font-medium text-marca-700 hover:underline">
                      {numeroComprobanteCompra({ ...c, punto_venta: Number(c.punto_venta) })}
                    </Link>
                  </td>
                  <td className="text-right tabular-nums">{pesos(Number(c.total))}</td>
                  <td>
                    <Pastilla tono={TONO_ESTADO_COMPROBANTE_COMPRA[c.estado]}>
                      {NOMBRES_ESTADO_COMPROBANTE_COMPRA[c.estado]}
                    </Pastilla>
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
