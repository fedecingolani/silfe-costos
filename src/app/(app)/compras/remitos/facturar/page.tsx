import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Tarjeta } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { letraSugerida } from "@/lib/compras/comprobantes/letra";
import { seleccionInicial } from "@/lib/compras/remitos/facturacion";
import type { CondicionIva } from "@/lib/tipos";
import { cargarPendientes, cargarProveedoresConPendientes } from "../datos";
import { FacturarRemitosCompra } from "./FacturarRemitosCompra";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const migasBase = [{ href: "/compras/remitos", texto: "Remitos de compra" }, { texto: "Facturar" }];

/** Sin proveedor: los proveedores con algo pendiente de facturar en remitos recibidos. */
async function ElegirProveedor() {
  const supabase = await createClient();
  const proveedores = await cargarProveedoresConPendientes(supabase);
  if (typeof proveedores === "string") return <p className="text-sm text-red-700">{proveedores}</p>;
  return (
    <>
      <Migas items={migasBase} />
      <Encabezado
        titulo="Facturar remitos de compra"
        descripcion="Elegí el proveedor: se listan sólo los que tienen remitos recibidos con algo pendiente de facturar."
      />
      <Tarjeta titulo="Proveedores con remitos pendientes">
        {proveedores.length === 0 ? (
          <p className="p-4 text-sm text-stone-500">No hay remitos recibidos con algo pendiente de facturar.</p>
        ) : (
          <ul className="divide-y divide-stone-100">
            {proveedores.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/compras/remitos/facturar?proveedor=${p.id}`}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:bg-marca-50"
                >
                  <span className="font-medium text-stone-900">{p.nombre}</span>
                  <span className="text-xs text-stone-500">
                    {p.remitos} {p.remitos === 1 ? "remito" : "remitos"}
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

/**
 * Facturar remitos de compra de un proveedor: ?proveedor=<id>. Con
 * &remito=<id> (desde el detalle de un remito) arrancan elegidos sólo los
 * renglones de ese remito.
 */
export default async function FacturarRemitosCompraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { proveedor: parametro, remito } = await searchParams;
  const proveedorId = typeof parametro === "string" && UUID.test(parametro) ? parametro : null;
  if (!proveedorId) return <ElegirProveedor />;
  const remitoId = typeof remito === "string" && UUID.test(remito) ? remito : null;

  const supabase = await createClient();
  const [pendientes, { data: proveedor, error }] = await Promise.all([
    cargarPendientes(supabase, proveedorId),
    supabase.from("proveedor").select("id, nombre, condicion_iva").eq("id", proveedorId).maybeSingle(),
  ]);
  if (typeof pendientes === "string") return <p className="text-sm text-red-700">{pendientes}</p>;
  if (error) return <p className="text-sm text-red-700">Error al cargar el proveedor: {error.message}</p>;
  if (!proveedor) return <ElegirProveedor />;

  // Si el remito pedido ya no tiene nada pendiente, se ofrecen todos elegidos.
  const conRemito = remitoId !== null && pendientes.some((p) => p.remito_compra_id === remitoId);
  const renglones = seleccionInicial(pendientes, conRemito ? remitoId : null);
  const nombre = proveedor.nombre as string;
  return (
    <>
      <Migas
        items={[
          { href: "/compras/remitos", texto: "Remitos de compra" },
          { href: "/compras/remitos/facturar", texto: "Facturar" },
          { texto: nombre },
        ]}
      />
      <Encabezado
        titulo={`Facturar remitos de ${nombre}`}
        descripcion="Elegí qué facturar y cuánto (por defecto, todo lo pendiente) y cargá el número de la factura del proveedor. Se crea un borrador de factura con el precio vigente sugerido, para revisar y confirmar."
        acciones={
          <Link href="/compras/remitos/facturar" className="boton-secundario">
            Otro proveedor
          </Link>
        }
      />
      {renglones.length === 0 ? (
        <Tarjeta titulo="Sin pendientes">
          <p className="p-4 text-sm text-stone-500">El proveedor no tiene remitos recibidos con algo pendiente de facturar.</p>
        </Tarjeta>
      ) : (
        <FacturarRemitosCompra
          proveedorId={proveedorId}
          letraInicial={letraSugerida((proveedor.condicion_iva ?? null) as CondicionIva | null)}
          renglones={renglones}
          hoy={hoyArgentina()}
        />
      )}
    </>
  );
}
