import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Tarjeta } from "@/components/ui";
import { seleccionInicial } from "@/lib/remitos/facturacion";
import type { CondicionIva } from "@/lib/tipos";
import { cargarClientesConPendientes, cargarPendientes } from "../datos";
import { FacturarRemitos } from "./FacturarRemitos";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const migasBase = [
  { href: "/remitos", texto: "Remitos" },
  { texto: "Facturar" },
];

/** Sin cliente: los clientes con algo pendiente de facturar en remitos emitidos. */
async function ElegirCliente() {
  const supabase = await createClient();
  const clientes = await cargarClientesConPendientes(supabase);
  if (typeof clientes === "string") return <p className="text-sm text-red-700">{clientes}</p>;
  return (
    <>
      <Migas items={migasBase} />
      <Encabezado titulo="Facturar remitos" descripcion="Elegí el cliente: se listan sólo los que tienen remitos con algo pendiente de facturar." />
      <Tarjeta titulo="Clientes con remitos pendientes">
        {clientes.length === 0 ? (
          <p className="p-4 text-sm text-stone-500">No hay remitos emitidos con algo pendiente de facturar.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {clientes.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/remitos/facturar?cliente=${c.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-marca-50"
                >
                  <span className="font-medium text-stone-900">{c.razon_social}</span>
                  <span className="text-xs text-stone-500">
                    {c.remitos} {c.remitos === 1 ? "remito" : "remitos"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </>
  );
}

export default async function FacturarRemitosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { cliente: parametro } = await searchParams;
  const clienteId = typeof parametro === "string" && UUID.test(parametro) ? parametro : null;
  if (!clienteId) return <ElegirCliente />;

  const supabase = await createClient();
  const [pendientes, { data: cliente, error: errorCliente }, { data: puntos, error: errorPuntos }] = await Promise.all([
    cargarPendientes(supabase, clienteId),
    supabase.from("cliente").select("id, razon_social, cuit, condicion_iva").eq("id", clienteId).maybeSingle(),
    supabase.from("punto_venta").select("numero, electronico").eq("activo", true).order("numero"),
  ]);
  if (typeof pendientes === "string") return <p className="text-sm text-red-700">{pendientes}</p>;
  const errorCarga = errorCliente ?? errorPuntos;
  if (errorCarga) return <p className="text-sm text-red-700">Error al cargar la facturación: {errorCarga.message}</p>;
  if (!cliente) return <ElegirCliente />;

  const items = seleccionInicial(pendientes);
  return (
    <>
      <Migas items={[{ href: "/remitos", texto: "Remitos" }, { href: "/remitos/facturar", texto: "Facturar" }, { texto: cliente.razon_social }]} />
      <Encabezado
        titulo={`Facturar remitos de ${cliente.razon_social}`}
        descripcion="Elegí qué facturar y cuánto (por defecto, todo lo pendiente). Se crea un borrador de factura para revisar y emitir."
        acciones={
          <Link href="/remitos/facturar" className="boton-secundario">
            Otro cliente
          </Link>
        }
      />
      {items.length === 0 ? (
        <Tarjeta titulo="Sin pendientes">
          <p className="p-4 text-sm text-stone-500">El cliente no tiene remitos emitidos con algo pendiente de facturar.</p>
        </Tarjeta>
      ) : (
        <FacturarRemitos
          clienteId={cliente.id as string}
          condicionIva={(cliente.condicion_iva ?? null) as CondicionIva | null}
          items={items}
          cantidades={Object.fromEntries(
            pendientes.map((f) => [f.remito_item_id, { cantidad: Number(f.cantidad), facturado: Number(f.facturado) }]),
          )}
          puntosVenta={(puntos ?? []).map((p) => ({ numero: Number(p.numero), electronico: Boolean(p.electronico) }))}
        />
      )}
    </>
  );
}
