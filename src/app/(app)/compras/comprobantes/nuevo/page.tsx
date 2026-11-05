import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { cargarContextoEditorCompra } from "../datos";
import { EditorComprobanteCompra } from "../EditorComprobanteCompra";

export const dynamic = "force-dynamic";

export default async function NuevoComprobanteCompraPage() {
  const supabase = await createClient();
  const contexto = await cargarContextoEditorCompra(supabase);
  if (typeof contexto === "string") {
    return <p className="text-sm text-red-700">Error al cargar los datos del comprobante: {contexto}</p>;
  }

  return (
    <>
      <Migas items={[{ href: "/compras/comprobantes", texto: "Comprobantes de compra" }, { texto: "Nuevo" }]} />
      <Encabezado
        titulo="Nuevo comprobante de compra"
        descripcion="Factura, nota de crédito o de débito de un proveedor. Se guarda como borrador hasta confirmarlo."
      />
      <EditorComprobanteCompra guardado={null} contexto={contexto} articulos={[]} hoy={hoyArgentina()} />
    </>
  );
}
