import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Cliente, Transporte, Zona } from "@/lib/tipos";
import { filtroActivo, filtroBusquedaClientes } from "@/lib/clientes/busqueda";
import { crearCliente, eliminarCliente } from "./acciones";
import { FilaCliente } from "./componentes";
import { FormularioCliente } from "./FormularioCliente";

export const dynamic = "force-dynamic";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; zona?: string; estado?: string }>;
}) {
  const { q, zona, estado } = await searchParams;
  const texto = (q ?? "").trim();
  // Un valor que no es un uuid haría fallar la consulta: se ignora.
  const zonaId = /^[0-9a-f-]{36}$/i.test(zona ?? "") ? (zona as string) : "";
  const filtroEstado = filtroActivo(estado);
  const supabase = await createClient();

  let consulta = supabase.from("cliente").select("*").order("razon_social");
  const busqueda = filtroBusquedaClientes(texto);
  if (busqueda) consulta = consulta.or(busqueda);
  if (zonaId) consulta = consulta.eq("zona_id", zonaId);
  if (filtroEstado.activo !== null) consulta = consulta.eq("activo", filtroEstado.activo);

  const [{ data, error }, { data: zonasData }, { data: transportesData }] = await Promise.all([
    consulta,
    supabase.from("zona").select("*").order("nombre"),
    supabase.from("transporte").select("*").order("nombre"),
  ]);

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar clientes: {error.message}</p>;
  }

  const clientes = (data ?? []) as Cliente[];
  const zonas = (zonasData ?? []) as Zona[];
  const transportes = (transportesData ?? []) as Transporte[];
  const zonaPorId = new Map(zonas.map((z) => [z.id, z.nombre]));
  const transportePorId = new Map(transportes.map((t) => [t.id, t.nombre]));
  const hayFiltros = texto !== "" || zonaId !== "" || filtroEstado.valor !== "activos";

  return (
    <>
      <Encabezado
        titulo="Clientes"
        descripcion="Clientes a los que se les vende, con su zona, transporte y datos de contacto."
        acciones={
          <Modal boton="+ Agregar cliente" titulo="Nuevo cliente">
            <FormularioCliente accion={crearCliente} zonas={zonas} transportes={transportes} />
          </Modal>
        }
      />

      <form method="get" className="tarjeta mb-4 grid gap-3 p-4 sm:grid-cols-12">
        <div className="sm:col-span-6">
          <label className="etiqueta" htmlFor="buscar-clientes">
            Buscar
          </label>
          <input
            id="buscar-clientes"
            name="q"
            type="search"
            defaultValue={texto}
            placeholder="Razón social, CUIT o código legado"
            className="campo"
          />
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-zona">
            Zona
          </label>
          <select id="filtro-zona" name="zona" defaultValue={zonaId} className="campo">
            <option value="">Todas</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="etiqueta" htmlFor="filtro-estado">
            Estado
          </label>
          <select id="filtro-estado" name="estado" defaultValue={filtroEstado.valor} className="campo">
            <option value="activos">Activos</option>
            <option value="inactivos">Inactivos</option>
            <option value="todos">Todos</option>
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2">
          <button type="submit" className="boton-primario">
            Filtrar
          </button>
          {hayFiltros && (
            <Link href="/clientes" className="boton-secundario">
              Limpiar
            </Link>
          )}
        </div>
      </form>

      <Tarjeta titulo={`${clientes.length} clientes`}>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Razón social</th>
                <th>CUIT</th>
                <th>Zona</th>
                <th>Localidad</th>
                <th>Teléfono</th>
                <th>Transporte</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clientes.length === 0 && (
                <Vacio
                  mensaje={
                    hayFiltros
                      ? "Ningún cliente coincide con la búsqueda."
                      : "Todavía no cargaste clientes."
                  }
                  colSpan={8}
                />
              )}
              {clientes.map((c) => (
                <FilaCliente
                  key={c.id}
                  cliente={c}
                  zona={c.zona_id ? (zonaPorId.get(c.zona_id) ?? null) : null}
                  transporte={c.transporte_id ? (transportePorId.get(c.transporte_id) ?? null) : null}
                  eliminar={eliminarCliente}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>
    </>
  );
}
