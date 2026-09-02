import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, Migas, BotonEliminar } from "@/components/ui";
import type { Cliente, ClienteContacto, Zona } from "@/lib/tipos";
import { eliminarCliente, agregarContacto, actualizarContacto, eliminarContacto } from "../acciones";
import {
  CampoNombreContacto,
  CampoCargoContacto,
  CampoTelefonoContacto,
  FormularioContacto,
} from "./formularios";

export const dynamic = "force-dynamic";

export default async function ClientePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: cli }, { data: contactosData }, { data: zonasData }] = await Promise.all([
    supabase.from("cliente").select("*").eq("id", id).maybeSingle(),
    supabase.from("cliente_contacto").select("*").eq("cliente_id", id).order("orden"),
    supabase.from("zona").select("*").order("nombre"),
  ]);

  if (!cli) notFound();

  const cliente = cli as Cliente;
  const contactos = (contactosData ?? []) as ClienteContacto[];
  const zonas = (zonasData ?? []) as Zona[];
  const zona = zonas.find((z) => z.id === cliente.zona_id);

  return (
    <>
      <Migas items={[{ href: "/clientes", texto: "Clientes" }, { texto: cliente.razon_social }]} />
      <Encabezado
        titulo={cliente.razon_social}
        descripcion={`${cliente.cuit ?? "Sin CUIT"}${cliente.localidad ? ` · ${cliente.localidad}` : ""}${
          zona ? ` · ${zona.nombre}` : ""
        }`}
        acciones={
          <>
            {cliente.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}
            <Link href={`/clientes?editar=${cliente.id}`} className="boton-secundario">
              Editar datos
            </Link>
            <form action={eliminarCliente}>
              <input type="hidden" name="id" value={cliente.id} />
              <BotonEliminar>Eliminar</BotonEliminar>
            </form>
          </>
        }
      />

      <Tarjeta titulo="Contactos" descripcion="Personas de contacto en este cliente.">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Teléfono</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contactos.length === 0 && (
                <Vacio mensaje="Todavía no cargaste contactos." colSpan={5} />
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
                        clienteId={cliente.id}
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
                    <td className="text-right">
                      <form action={eliminarContacto} className="flex h-7 items-center justify-end">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="cliente_id" value={cliente.id} />
                        <BotonEliminar title="Eliminar contacto">×</BotonEliminar>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <FormularioContacto clienteId={cliente.id} accion={agregarContacto} />
      </Tarjeta>
    </>
  );
}
