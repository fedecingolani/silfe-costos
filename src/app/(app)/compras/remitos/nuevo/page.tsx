import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { cargarContextoEditorCompra } from "../../comprobantes/datos";
import { EditorRemitoCompra } from "../EditorRemitoCompra";

export const dynamic = "force-dynamic";

export default async function NuevoRemitoCompraPage() {
  const supabase = await createClient();
  const contexto = await cargarContextoEditorCompra(supabase);
  if (typeof contexto === "string") {
    return <p className="text-sm text-red-700">Error al cargar los datos del remito: {contexto}</p>;
  }
  return (
    <>
      <Migas items={[{ href: "/compras/remitos", texto: "Remitos de compra" }, { texto: "Nuevo" }]} />
      <Encabezado
        titulo="Nuevo remito de compra"
        descripcion="La mercadería que entregó un proveedor, con el número de su remito. Se guarda como borrador hasta registrarlo como recibido."
      />
      <EditorRemitoCompra guardado={null} contexto={contexto} articulos={[]} hoy={hoyArgentina()} />
    </>
  );
}
