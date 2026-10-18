import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import { filtroBusquedaClientes } from "@/lib/clientes/busqueda";
import {
  ESTADOS_CARTERA,
  estadoChequeVisible,
  filtrarPorEstado,
  leerFiltrosCartera,
  totalesPorEstado,
  type FiltrosCartera,
} from "@/lib/cobranzas/cartera";
import { NOMBRES_ESTADO_CHEQUE, type EstadoCheque, type EstadoComprobante, type TipoCheque } from "@/lib/tipos";

export const dynamic = "force-dynamic";

/** Tope de filas: la cartera no pagina todavía. */
const LIMITE = 1000;

type Fila = {
  id: string;
  recibo_id: string;
  tipo: TipoCheque;
  banco: string;
  numero: string;
  fecha_pago: string;
  librador: string | null;
  importe: number;
  estado: EstadoCheque;
  nd_comprobante_id: string | null;
  recibo_numero_texto: string | null;
  razon_social: string;
  nd_estado: EstadoComprobante | null;
  nd_numero_texto: string | null;
};

/** URL del listado con el estado cambiado y los demás filtros. */
function conEstado(filtros: FiltrosCartera, estado: FiltrosCartera["estado"]): string {
  const p = new URLSearchParams();
  p.set("estado", estado);
  if (filtros.desde) p.set("desde", filtros.desde);
  if (filtros.hasta) p.set("hasta", filtros.hasta);
  if (filtros.cliente) p.set("cliente", filtros.cliente);
  return `/cheques?${p.toString()}`;
}

export default async function CarteraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltrosCartera(await searchParams);
  const supabase = await createClient();

  // Los totales por estado son de lo que filtran las fechas y el cliente; el
  // estado elige qué filas se listan.
  const busqueda = filtroBusquedaClientes(filtros.cliente);
  let consulta = supabase
    .from("v_cheque_cartera")
    .select(
      "id, recibo_id, tipo, banco, numero, fecha_pago, librador, importe, estado, nd_comprobante_id, " +
        "recibo_numero_texto, razon_social, nd_estado, nd_numero_texto",
    )
    .order("fecha_pago")
    .order("numero")
    .limit(LIMITE);
  if (busqueda) consulta = consulta.or(busqueda);
  if (filtros.desde) consulta = consulta.gte("fecha_pago", filtros.desde);
  if (filtros.hasta) consulta = consulta.lte("fecha_pago", filtros.hasta);

  const { data, error } = await consulta;
  if (error) return <p className="text-sm text-red-700">Error al cargar la cartera: {error.message}</p>;
  const todas = ((data ?? []) as unknown as Fila[]).map((f) => ({ ...f, importe: Number(f.importe) }));
  const totales = totalesPorEstado(todas);
  const filas = filtrarPorEstado(todas, filtros.estado);
  const hayFiltros = Boolean(filtros.desde || filtros.hasta || filtros.cliente || filtros.estado !== "en_cartera");

  return (
    <>
      <Encabezado
        titulo="Cartera de cheques"
        descripcion="Cheques y e-cheqs recibidos en cobranzas emitidas. Rechazar un cheque crea la nota de débito al cliente."
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {ESTADOS_CARTERA.map((estado) => {
          const activo = filtros.estado === estado;
          return (
            <Link
              key={estado}
              href={conEstado(filtros, estado)}
              aria-current={activo ? "true" : undefined}
              className={`tarjeta block px-4 py-3 transition hover:border-marca-300 ${
                activo ? "border-marca-300 bg-marca-50" : ""
              }`}
            >
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{NOMBRES_ESTADO_CHEQUE[estado]}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-stone-900">{pesos(totales[estado].importe)}</p>
              <p className="mt-0.5 text-xs text-stone-500">
                {totales[estado].cantidad} {totales[estado].cantidad === 1 ? "cheque" : "cheques"}
              </p>
            </Link>
          );
        })}
      </div>

      <form method="get" className="tarjeta mb-4 grid gap-3 p-4 sm:grid-cols-12">
        <div className="sm:col-span-3">
          <label className="etiqueta" htmlFor="filtro-estado">
            Estado
          </label>
          <select id="filtro-estado" name="estado" defaultValue={filtros.estado} className="campo">
            {ESTADOS_CARTERA.map((e) => (
              <option key={e} value={e}>
                {NOMBRES_ESTADO_CHEQUE[e]}
              </option>
            ))}
            <option value="todos">Todos</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-desde">
            Pago desde
          </label>
          <input id="filtro-desde" name="desde" type="date" defaultValue={filtros.desde} className="campo" />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-hasta">
            Pago hasta
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
        <div className="flex items-end gap-2 sm:col-span-12">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/cheques" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${filas.length} cheques`}
        descripcion={todas.length >= LIMITE ? `Se muestran los primeros ${LIMITE} por fecha de pago: acotá con los filtros.` : undefined}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Fecha de pago</th>
                <th>Banco</th>
                <th>Número</th>
                <th>Tipo</th>
                <th>Librador</th>
                <th>Cliente</th>
                <th className="text-right">Importe</th>
                <th>Estado</th>
                <th>Recibo</th>
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && (
                <Vacio
                  mensaje={hayFiltros ? "Ningún cheque coincide con los filtros." : "No hay cheques en cartera."}
                  colSpan={9}
                />
              )}
              {filas.map((c) => {
                const visible = estadoChequeVisible(c);
                return (
                  <tr key={c.id}>
                    <td className="whitespace-nowrap">{fecha(c.fecha_pago)}</td>
                    <td>{c.banco}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      <Link href={`/cheques/${c.id}`} className="font-medium text-marca-700 hover:underline">
                        {c.numero}
                      </Link>
                    </td>
                    <td>{c.tipo === "echeq" ? "E-cheq" : "Físico"}</td>
                    <td>{c.librador ?? "—"}</td>
                    <td>{c.razon_social}</td>
                    <td className="text-right tabular-nums">{pesos(c.importe)}</td>
                    <td>
                      <span className="flex flex-wrap items-center gap-1">
                        <Pastilla tono={visible.tono}>{NOMBRES_ESTADO_CHEQUE[c.estado]}</Pastilla>
                        {visible.nd && c.nd_comprobante_id && (
                          <Link
                            href={`/comprobantes/${c.nd_comprobante_id}`}
                            className={`text-xs hover:underline ${
                              c.nd_estado === "autorizado" ? "text-marca-700" : "font-medium text-amber-700"
                            }`}
                          >
                            {visible.nd}
                          </Link>
                        )}
                      </span>
                    </td>
                    <td className="whitespace-nowrap tabular-nums">
                      <Link href={`/cobranzas/${c.recibo_id}`} className="text-marca-700 hover:underline">
                        {c.recibo_numero_texto ?? "—"}
                      </Link>
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
