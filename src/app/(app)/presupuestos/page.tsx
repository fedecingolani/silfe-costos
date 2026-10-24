import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { filtroBusquedaClientes } from "@/lib/clientes/busqueda";
import {
  NOMBRES_ESTADO_PRESUPUESTO,
  TONO_ESTADO_PRESUPUESTO,
  estaVencido,
  leerFiltros,
  numeroPresupuesto,
} from "@/lib/presupuestos/listado";
import { ESTADOS_PRESUPUESTO, type Presupuesto } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Tope de filas: el listado no pagina todavía. */
const LIMITE = 500;

type Fila = Pick<Presupuesto, "id" | "numero" | "fecha" | "valido_hasta" | "estado" | "total"> & {
  cliente: { razon_social: string } | null;
};

export default async function PresupuestosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltros(await searchParams);
  const hoy = hoyArgentina();
  const supabase = await createClient();

  // El cliente se busca con la misma lógica que el listado de clientes; el
  // inner join deja sólo los presupuestos de los clientes que coinciden.
  const busqueda = filtroBusquedaClientes(filtros.cliente);
  let consulta = supabase
    .from("presupuesto")
    .select(`id, numero, fecha, valido_hasta, estado, total, cliente${busqueda ? "!inner" : ""}(razon_social)`)
    .order("fecha", { ascending: false })
    .order("numero", { ascending: false })
    .limit(LIMITE);
  if (busqueda) consulta = consulta.or(busqueda, { referencedTable: "cliente" });
  if (filtros.desde) consulta = consulta.gte("fecha", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("fecha", filtros.hasta);
  if (filtros.estado) consulta = consulta.eq("estado", filtros.estado);
  // Vencido: abierto y con la validez ya pasada (estaVencido).
  if (filtros.vencidos) consulta = consulta.eq("estado", "abierto").lt("valido_hasta", hoy);

  const { data, error } = await consulta;
  if (error) return <p className="text-sm text-red-700">Error al cargar los presupuestos: {error.message}</p>;
  const filas = (data ?? []) as unknown as Fila[];
  const hayFiltros = Boolean(filtros.desde || filtros.hasta || filtros.cliente || filtros.estado || filtros.vencidos);

  return (
    <>
      <Encabezado
        titulo="Presupuestos"
        descripcion="Presupuestos de venta. Los abiertos se editan; al convertirlos en factura ya no se modifican."
        acciones={
          <Link href="/presupuestos/nuevo" className="boton-primario">
            + Nuevo presupuesto
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
            {ESTADOS_PRESUPUESTO.map((e) => (
              <option key={e} value={e}>
                {NOMBRES_ESTADO_PRESUPUESTO[e]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end sm:col-span-2">
          <label className="flex items-center gap-1.5 pb-2 text-sm">
            <input type="checkbox" name="vencidos" value="1" defaultChecked={filtros.vencidos} />
            Sólo vencidos
          </label>
        </div>
        <div className="flex items-end gap-2 sm:col-span-12">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/presupuestos" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${filas.length} presupuestos`}
        descripcion={filas.length >= LIMITE ? `Se muestran los ${LIMITE} más recientes: acotá con los filtros.` : undefined}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Número</th>
                <th>Fecha</th>
                <th>Cliente</th>
                <th>Válido hasta</th>
                <th>Estado</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <Vacio
                  mensaje={hayFiltros ? "Ningún presupuesto coincide con los filtros." : "Todavía no hay presupuestos."}
                  colSpan={6}
                />
              )}
              {filas.map((p) => (
                <tr key={p.id}>
                  <td className="whitespace-nowrap tabular-nums">
                    <Link href={`/presupuestos/${p.id}`} className="font-medium text-marca-700 hover:underline">
                      {numeroPresupuesto(p.numero)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap">{fecha(p.fecha)}</td>
                  <td>{p.cliente?.razon_social ?? "—"}</td>
                  <td className="whitespace-nowrap">
                    {fecha(p.valido_hasta)}
                    {p.estado === "abierto" && estaVencido(p.valido_hasta, hoy) && (
                      <span className="ml-2">
                        <Pastilla tono="ambar">Vencido</Pastilla>
                      </span>
                    )}
                  </td>
                  <td>
                    <Pastilla tono={TONO_ESTADO_PRESUPUESTO[p.estado]}>{NOMBRES_ESTADO_PRESUPUESTO[p.estado]}</Pastilla>
                  </td>
                  <td className="text-right tabular-nums">{pesos(Number(p.total))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}
