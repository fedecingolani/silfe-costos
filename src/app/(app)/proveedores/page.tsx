import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Proveedor } from "@/lib/tipos";
import { crearProveedor, actualizarProveedor, eliminarProveedor } from "./acciones";
import { FilaProveedor, FormularioProveedor } from "./componentes";

export const dynamic = "force-dynamic";

export default async function ProveedoresPage({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string }>;
}) {
  const { editar } = await searchParams;
  const supabase = await createClient();
  const { data, error } = await supabase.from("proveedor").select("*").order("nombre");

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar proveedores: {error.message}</p>;
  }

  const proveedores = (data ?? []) as Proveedor[];
  const enEdicion = proveedores.find((p) => p.id === editar);

  return (
    <>
      <Encabezado
        titulo="Proveedores"
        descripcion="Quién nos vende cada materia prima. Cada precio de compra se asocia a un proveedor."
        acciones={
          <Modal boton="+ Agregar proveedor" titulo="Nuevo proveedor">
            <FormularioProveedor accion={crearProveedor} />
          </Modal>
        }
      />

      <Tarjeta titulo={`${proveedores.length} proveedores`}>
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>CUIT</th>
                <th>Contacto</th>
                <th>Teléfono / Email</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {proveedores.length === 0 && (
                <Vacio mensaje="Todavía no cargaste proveedores." colSpan={6} />
              )}
              {proveedores.map((p) => (
                <FilaProveedor key={p.id} proveedor={p} eliminar={eliminarProveedor} />
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {enEdicion && (
        <Modal titulo={`Editar: ${enEdicion.nombre}`} abierto hrefAlCerrar="/proveedores">
          <FormularioProveedor
            key={enEdicion.id}
            accion={actualizarProveedor}
            proveedor={enEdicion}
            cancelarHref="/proveedores"
          />
        </Modal>
      )}
    </>
  );
}
