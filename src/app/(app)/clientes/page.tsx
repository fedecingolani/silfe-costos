import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Cliente, Zona } from "@/lib/tipos";
import { crearCliente, actualizarCliente, eliminarCliente } from "./acciones";
import { FilaCliente, FormularioCliente } from "./componentes";

export const dynamic = "force-dynamic";

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string }>;
}) {
  const { editar } = await searchParams;
  const supabase = await createClient();

  const [{ data, error }, { data: zonasData }] = await Promise.all([
    supabase.from("cliente").select("*").order("razon_social"),
    supabase.from("zona").select("*").order("nombre"),
  ]);

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar clientes: {error.message}</p>;
  }

  const clientes = (data ?? []) as Cliente[];
  const zonas = (zonasData ?? []) as Zona[];
  const enEdicion = clientes.find((c) => c.id === editar);
  const zonaPorId = new Map(zonas.map((z) => [z.id, z.nombre]));

  return (
    <>
      <Encabezado
        titulo="Clientes"
        descripcion="Clientes a los que se les vende, con su zona y datos de contacto."
        acciones={
          <Modal boton="+ Agregar cliente" titulo="Nuevo cliente">
            <FormularioCliente accion={crearCliente} zonas={zonas} />
          </Modal>
        }
      />

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
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {clientes.length === 0 && (
                <Vacio mensaje="Todavía no cargaste clientes." colSpan={7} />
              )}
              {clientes.map((c) => (
                <FilaCliente
                  key={c.id}
                  cliente={c}
                  zona={c.zona_id ? (zonaPorId.get(c.zona_id) ?? null) : null}
                  eliminar={eliminarCliente}
                />
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {enEdicion && (
        <Modal titulo={`Editar: ${enEdicion.razon_social}`} abierto hrefAlCerrar="/clientes">
          <FormularioCliente
            key={enEdicion.id}
            accion={actualizarCliente}
            cliente={enEdicion}
            zonas={zonas}
            cancelarHref="/clientes"
          />
        </Modal>
      )}
    </>
  );
}
