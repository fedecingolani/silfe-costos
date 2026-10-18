import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Kpi, Pastilla, Tarjeta, Vacio } from "@/components/ui";
import { fecha, pesos } from "@/lib/formato";
import { filtroBusquedaClientes } from "@/lib/clientes/busqueda";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import {
  diasDeAntiguedad,
  estadoSaldo,
  leerFiltrosCuentas,
  ordenarCuentas,
  totalesCuentas,
  type FilaCuenta,
  type OrdenCuentas,
} from "@/lib/cobranzas/cuenta-corriente";

export const dynamic = "force-dynamic";

/** Tope de clientes: el listado no pagina todavía. */
const LIMITE = 1000;

type FilaVista = {
  cliente_id: string;
  razon_social: string;
  saldo: number;
  deuda_pendiente: number;
  saldo_a_favor: number;
  pendiente_mas_viejo: string | null;
  pendientes: number;
};

const ORDENES: { valor: OrdenCuentas; texto: string }[] = [
  { valor: "saldo", texto: "Saldo (mayor primero)" },
  { valor: "antiguedad", texto: "Antigüedad (deuda más vieja primero)" },
];

/**
 * Ventas → Cuentas corrientes: clientes con saldo, pendientes o saldo a
 * favor (v_cliente_cuenta_resumen), con la deuda más vieja y los totales de
 * lo que se muestra.
 */
export default async function CuentasCorrientesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filtros = leerFiltrosCuentas(await searchParams);
  const supabase = await createClient();
  const hoy = hoyArgentina();

  const busqueda = filtroBusquedaClientes(filtros.texto);
  let consulta = supabase
    .from("v_cliente_cuenta_resumen")
    .select("cliente_id, razon_social, saldo, deuda_pendiente, saldo_a_favor, pendiente_mas_viejo, pendientes")
    .order("saldo", { ascending: false })
    .limit(LIMITE);
  if (busqueda) consulta = consulta.or(busqueda);

  const { data, error } = await consulta;
  if (error) return <p className="text-sm text-red-700">Error al cargar las cuentas corrientes: {error.message}</p>;

  const filas: FilaCuenta[] = ((data ?? []) as FilaVista[]).map((f) => ({
    clienteId: f.cliente_id,
    razonSocial: f.razon_social,
    saldo: Number(f.saldo),
    deudaPendiente: Number(f.deuda_pendiente),
    saldoAFavor: Number(f.saldo_a_favor),
    pendienteMasViejo: f.pendiente_mas_viejo,
    pendientes: Number(f.pendientes),
  }));
  const ordenadas = ordenarCuentas(filas, filtros.orden);
  const totales = totalesCuentas(filas);

  return (
    <>
      <Encabezado
        titulo="Cuentas corrientes"
        descripcion="Clientes con saldo, comprobantes pendientes o saldo a favor. Sin homologación ni recibos anulados."
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Kpi etiqueta="Total adeudado" valor={pesos(totales.adeudado)} />
        <Kpi etiqueta="Total a favor" valor={pesos(totales.aFavor)} />
        <Kpi etiqueta="Clientes" valor={String(filas.length)} />
      </div>

      <form method="get" className="tarjeta mb-4 grid gap-3 p-4 sm:grid-cols-12">
        <div className="sm:col-span-6">
          <label className="etiqueta" htmlFor="filtro-q">
            Cliente
          </label>
          <input
            id="filtro-q"
            name="q"
            type="search"
            defaultValue={filtros.texto}
            placeholder="Razón social, CUIT o código"
            className="campo"
          />
        </div>
        <div className="sm:col-span-4">
          <label className="etiqueta" htmlFor="filtro-orden">
            Ordenar por
          </label>
          <select id="filtro-orden" name="orden" defaultValue={filtros.orden} className="campo">
            {ORDENES.map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {(filtros.texto || filtros.orden !== "saldo") && (
            <Link href="/cuentas-corrientes" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta
        titulo={`${filas.length} clientes`}
        descripcion={filas.length >= LIMITE ? `Se muestran ${LIMITE}: acotá con el filtro.` : undefined}
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Cliente</th>
                <th className="text-right">Saldo</th>
                <th className="text-right">A favor</th>
                <th>Deuda más vieja</th>
                <th className="text-right">Pendientes</th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.length === 0 && (
                <Vacio
                  mensaje={filtros.texto ? "Ningún cliente coincide con el filtro." : "Ningún cliente tiene saldo."}
                  colSpan={5}
                />
              )}
              {ordenadas.map((f) => {
                const estado = estadoSaldo(f.saldo);
                return (
                  <tr key={f.clienteId}>
                    <td>
                      <Link
                        href={`/clientes/${f.clienteId}#cuenta-corriente`}
                        className="font-medium text-marca-700 hover:underline"
                      >
                        {f.razonSocial}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-right tabular-nums">
                      <span className={estado.tono === "rojo" ? "text-red-700" : estado.tono === "azul" ? "text-sky-700" : ""}>
                        {pesos(f.saldo)}
                      </span>{" "}
                      <Pastilla tono={estado.tono}>{estado.texto}</Pastilla>
                    </td>
                    <td className="text-right tabular-nums">{f.saldoAFavor ? pesos(f.saldoAFavor) : "—"}</td>
                    <td className="whitespace-nowrap">
                      {f.pendienteMasViejo
                        ? `${fecha(f.pendienteMasViejo)} (${diasDeAntiguedad(f.pendienteMasViejo, hoy)} días)`
                        : "—"}
                    </td>
                    <td className="text-right tabular-nums">{f.pendientes}</td>
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
