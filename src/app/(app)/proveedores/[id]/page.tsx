import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, Migas, BotonEliminar } from "@/components/ui";
import type { Proveedor, ProveedorContacto } from "@/lib/tipos";
import { eliminarProveedor, agregarContacto, actualizarContacto, eliminarContacto } from "../acciones";
import {
  CampoNombreContacto,
  CampoCargoContacto,
  CampoTelefonoContacto,
  CampoEmailContacto,
  FormularioContacto,
} from "./formularios";

export const dynamic = "force-dynamic";

export default async function ProveedorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: prov }, { data: contactosData }] = await Promise.all([
    supabase.from("proveedor").select("*").eq("id", id).maybeSingle(),
    supabase.from("proveedor_contacto").select("*").eq("proveedor_id", id).order("orden"),
  ]);

  if (!prov) notFound();

  const proveedor = prov as Proveedor;
  const contactos = (contactosData ?? []) as ProveedorContacto[];

  return (
    <>
      <Migas items={[{ href: "/proveedores", texto: "Proveedores" }, { texto: proveedor.nombre }]} />
      <Encabezado
        titulo={proveedor.nombre}
        descripcion={proveedor.cuit ?? "Sin CUIT"}
        acciones={
          <>
            {proveedor.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}
            <Link href={`/proveedores?editar=${proveedor.id}`} className="boton-secundario">
              Editar datos
            </Link>
            <form action={eliminarProveedor}>
              <input type="hidden" name="id" value={proveedor.id} />
              <BotonEliminar>Eliminar</BotonEliminar>
            </form>
          </>
        }
      />

      <Tarjeta titulo="Contactos" descripcion="Personas de contacto en este proveedor.">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contactos.length === 0 && (
                <Vacio mensaje="Todavía no cargaste contactos." colSpan={6} />
              )}
              {contactos.map((c) => {
                const formId = `form-contacto-${c.id}`;
                return (
                  <tr key={c.id}>
                    <td className="text-xs text-stone-400">
                      <div className="flex h-7 items-center">{c.orden}</div>
                    </td>
                    <td>
                      <CampoNombreContacto
                        formId={formId}
                        id={c.id}
                        proveedorId={proveedor.id}
                        nombre={c.nombre}
                        accion={actualizarContacto}
                      />
                    </td>
                    <td>
                      <CampoCargoContacto formId={formId} cargo={c.cargo} />
                    </td>
                    <td>
                      <CampoTelefonoContacto formId={formId} telefono={c.telefono} />
                    </td>
                    <td>
                      <CampoEmailContacto formId={formId} email={c.email} />
                    </td>
                    <td className="text-right">
                      <form action={eliminarContacto} className="flex h-7 items-center justify-end">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="proveedor_id" value={proveedor.id} />
                        <BotonEliminar title="Eliminar contacto">×</BotonEliminar>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <FormularioContacto proveedorId={proveedor.id} accion={agregarContacto} />
      </Tarjeta>
    </>
  );
}
