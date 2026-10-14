import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, Migas, BotonEliminar } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { Cliente, ClienteContacto, ClienteSucursal, Transporte, Zona } from "@/lib/tipos";
import { validarCbu, validarCuit, validarCvu } from "@/lib/clientes/validaciones";
import {
  actualizarCliente,
  eliminarCliente,
  agregarSucursal,
  actualizarSucursal,
  hacerSucursalPrincipal,
  eliminarSucursal,
  agregarContacto,
  actualizarContacto,
  eliminarContacto,
  type AvisoCliente,
} from "../acciones";
import { FormularioCliente } from "../FormularioCliente";
import { FormularioContacto, FormularioSucursal } from "./formularios";

export const dynamic = "force-dynamic";

/** Avisos que llegan por ?aviso= desde las acciones de la ficha. */
const AVISOS: Record<AvisoCliente, string> = {
  "cliente-no-eliminado": "No se pudo eliminar el cliente. Si ya tiene movimientos, desactivalo en lugar de borrarlo.",
  "sucursal-no-eliminada": "No se pudo eliminar la sucursal. Volvé a intentarlo.",
  "principal-no-marcada": "No se pudo marcar la sucursal como principal. Volvé a intentarlo.",
  "contacto-no-eliminado": "No se pudo eliminar el contacto. Volvé a intentarlo.",
};

/** Un dato de la ficha, con un aviso amarillo opcional que no bloquea. */
function Dato({ etiqueta, children, aviso }: { etiqueta: string; children: ReactNode; aviso?: string | null }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
      {aviso && <p className="mt-0.5 text-xs text-amber-700">⚠ {aviso}</p>}
    </div>
  );
}

function domicilio(d: {
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  codigo_postal: string | null;
}) {
  const lugar = [d.localidad, d.provincia].filter(Boolean).join(", ");
  const texto = [d.direccion, lugar, d.codigo_postal ? `CP ${d.codigo_postal}` : null]
    .filter(Boolean)
    .join(" · ");
  return texto || "—";
}

export default async function ClientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ editar?: string; sucursal?: string; contacto?: string; aviso?: string }>;
}) {
  const { id } = await params;
  const { editar, sucursal: sucursalEnEdicionId, contacto: contactoEnEdicionId, aviso } = await searchParams;
  const mensajeAviso = aviso && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso as AvisoCliente] : undefined;
  const supabase = await createClient();

  const [
    { data: cli },
    { data: contactosData },
    { data: sucursalesData },
    { data: zonasData },
    { data: transportesData },
  ] = await Promise.all([
    supabase.from("cliente").select("*").eq("id", id).maybeSingle(),
    supabase.from("cliente_contacto").select("*").eq("cliente_id", id).order("orden").order("nombre"),
    supabase.from("cliente_sucursal").select("*").eq("cliente_id", id).order("orden").order("nombre"),
    supabase.from("zona").select("*").order("nombre"),
    supabase.from("transporte").select("*").order("nombre"),
  ]);

  if (!cli) notFound();

  const cliente = cli as Cliente;
  const contactos = (contactosData ?? []) as ClienteContacto[];
  const sucursales = (sucursalesData ?? []) as ClienteSucursal[];
  const zonas = (zonasData ?? []) as Zona[];
  const transportes = (transportesData ?? []) as Transporte[];
  const zona = zonas.find((z) => z.id === cliente.zona_id);
  const transportePorId = new Map(transportes.map((t) => [t.id, t.nombre]));
  const transporteHabitual = cliente.transporte_id ? (transportePorId.get(cliente.transporte_id) ?? null) : null;
  const sucursalPorId = new Map(sucursales.map((s) => [s.id, s.nombre]));
  const sucursalEnEdicion = sucursales.find((s) => s.id === sucursalEnEdicionId);
  const contactoEnEdicion = contactos.find((c) => c.id === contactoEnEdicionId);
  const href = `/clientes/${cliente.id}`;

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
            <Link href={`${href}?editar=1`} className="boton-secundario">
              Editar datos
            </Link>
            <form action={eliminarCliente}>
              <input type="hidden" name="id" value={cliente.id} />
              <BotonEliminar>Eliminar</BotonEliminar>
            </form>
          </>
        }
      />

      {mensajeAviso && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {mensajeAviso}
        </div>
      )}

      <Tarjeta titulo="Datos fiscales y comerciales" className="mb-6">
        <dl className="grid gap-4 p-4 sm:grid-cols-3">
          <Dato etiqueta="CUIT" aviso={validarCuit(cliente.cuit).mensaje}>
            {cliente.cuit ?? "—"}
          </Dato>
          <Dato etiqueta="Condición frente al IVA">{cliente.condicion_iva ?? "—"}</Dato>
          <Dato etiqueta="Código legado">{cliente.codigo_legado ?? "—"}</Dato>
          <Dato etiqueta="Domicilio fiscal">{domicilio(cliente)}</Dato>
          <Dato etiqueta="Teléfono">{cliente.telefono ?? "—"}</Dato>
          <Dato etiqueta="Zona">{zona?.nombre ?? "—"}</Dato>
          <Dato etiqueta="CBU" aviso={validarCbu(cliente.cbu).mensaje}>
            <span className="font-mono">{cliente.cbu ?? "—"}</span>
          </Dato>
          <Dato etiqueta="CVU" aviso={validarCvu(cliente.cvu).mensaje}>
            <span className="font-mono">{cliente.cvu ?? "—"}</span>
          </Dato>
          <Dato etiqueta="Alias">{cliente.alias_bancario ?? "—"}</Dato>
          <Dato etiqueta="Transporte habitual">{transporteHabitual ?? "—"}</Dato>
          <div className="sm:col-span-2">
            <Dato etiqueta="Observaciones">
              <span className="whitespace-pre-line">{cliente.observaciones ?? "—"}</span>
            </Dato>
          </div>
        </dl>
      </Tarjeta>

      <Tarjeta
        titulo="Sucursales y direcciones de entrega"
        descripcion="La principal es la dirección de entrega por defecto."
        className="mb-6"
        acciones={
          <Modal boton="+ Agregar sucursal" titulo="Nueva sucursal">
            <FormularioSucursal
              clienteId={cliente.id}
              accion={agregarSucursal}
              transportes={transportes}
              transporteHabitual={transporteHabitual}
            />
          </Modal>
        }
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Dirección</th>
                <th>Teléfono</th>
                <th>Entregas</th>
                <th>Transporte</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sucursales.length === 0 && (
                <Vacio mensaje="Todavía no cargaste sucursales ni direcciones de entrega." colSpan={6} />
              )}
              {sucursales.map((s) => (
                <tr key={s.id}>
                  <td>
                    <span className="font-medium text-stone-900">{s.nombre}</span>
                    {s.principal && (
                      <span className="ml-1.5">
                        <Pastilla tono="azul">Principal</Pastilla>
                      </span>
                    )}
                    {s.observaciones && <p className="text-xs text-stone-500">{s.observaciones}</p>}
                  </td>
                  <td className="text-stone-500">{domicilio(s)}</td>
                  <td className="text-stone-500">{s.telefono ?? "—"}</td>
                  <td>
                    {s.recibe_entregas ? <Pastilla tono="verde">Sí</Pastilla> : <Pastilla>No</Pastilla>}
                  </td>
                  <td className="text-stone-500">
                    {s.transporte_id
                      ? (transportePorId.get(s.transporte_id) ?? "—")
                      : transporteHabitual
                        ? `${transporteHabitual} (habitual)`
                        : "—"}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {!s.principal && (
                      <form action={hacerSucursalPrincipal} className="inline">
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="cliente_id" value={cliente.id} />
                        <button type="submit" className="mr-2 text-xs text-marca-700 hover:underline">
                          Hacer principal
                        </button>
                      </form>
                    )}
                    <Link href={`${href}?sucursal=${s.id}`} className="mr-2 text-xs text-marca-700 hover:underline">
                      Editar
                    </Link>
                    <form action={eliminarSucursal} className="inline">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="cliente_id" value={cliente.id} />
                      <BotonEliminar title="Eliminar sucursal">×</BotonEliminar>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Contactos"
        descripcion="Personas de contacto en este cliente."
        acciones={
          <Modal boton="+ Agregar contacto" titulo="Nuevo contacto">
            <FormularioContacto clienteId={cliente.id} accion={agregarContacto} sucursales={sucursales} />
          </Modal>
        }
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Sucursal</th>
                <th>Teléfono</th>
                <th>WhatsApp</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contactos.length === 0 && <Vacio mensaje="Todavía no cargaste contactos." colSpan={8} />}
              {contactos.map((c) => (
                <tr key={c.id}>
                  <td className="text-xs text-stone-400">{c.orden}</td>
                  <td>
                    <span className="font-medium text-stone-900">{c.nombre}</span>
                    {c.observaciones && <p className="text-xs text-stone-500">{c.observaciones}</p>}
                  </td>
                  <td className="text-stone-500">{c.cargo ?? "—"}</td>
                  <td className="text-stone-500">
                    {c.sucursal_id ? (sucursalPorId.get(c.sucursal_id) ?? "—") : "—"}
                  </td>
                  <td className="text-stone-500">{c.telefono ?? "—"}</td>
                  <td className="text-stone-500">{c.whatsapp ?? "—"}</td>
                  <td className="text-stone-500">
                    {c.email ? (
                      <a href={`mailto:${c.email}`} className="text-marca-700 hover:underline">
                        {c.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    <Link href={`${href}?contacto=${c.id}`} className="mr-2 text-xs text-marca-700 hover:underline">
                      Editar
                    </Link>
                    <form action={eliminarContacto} className="inline">
                      <input type="hidden" name="id" value={c.id} />
                      <input type="hidden" name="cliente_id" value={cliente.id} />
                      <BotonEliminar title="Eliminar contacto">×</BotonEliminar>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {editar && (
        <Modal titulo={`Editar: ${cliente.razon_social}`} abierto hrefAlCerrar={href}>
          <FormularioCliente
            key={cliente.id}
            accion={actualizarCliente}
            cliente={cliente}
            zonas={zonas}
            transportes={transportes}
            completo
            cancelarHref={href}
          />
        </Modal>
      )}

      {sucursalEnEdicion && (
        <Modal titulo={`Editar sucursal: ${sucursalEnEdicion.nombre}`} abierto hrefAlCerrar={href}>
          <FormularioSucursal
            key={sucursalEnEdicion.id}
            clienteId={cliente.id}
            accion={actualizarSucursal}
            sucursal={sucursalEnEdicion}
            transportes={transportes}
            transporteHabitual={transporteHabitual}
          />
        </Modal>
      )}

      {contactoEnEdicion && (
        <Modal titulo={`Editar contacto: ${contactoEnEdicion.nombre}`} abierto hrefAlCerrar={href}>
          <FormularioContacto
            key={contactoEnEdicion.id}
            clienteId={cliente.id}
            accion={actualizarContacto}
            contacto={contactoEnEdicion}
            sucursales={sucursales}
          />
        </Modal>
      )}
    </>
  );
}
