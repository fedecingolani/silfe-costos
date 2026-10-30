import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { cargarContextoEditor, cargarPrecios } from "../datos";
import { EditorComprobante } from "../EditorComprobante";

export const dynamic = "force-dynamic";

export default async function NuevoComprobantePage() {
  const supabase = await createClient();
  const contexto = await cargarContextoEditor(supabase);
  if (typeof contexto === "string") {
    return <p className="text-sm text-red-700">Error al cargar los datos del comprobante: {contexto}</p>;
  }
  // Por defecto, la lista creada más recientemente (la primera).
  const precios = await cargarPrecios(supabase, contexto.listas[0]?.id ?? null);

  return (
    <>
      <Migas items={[{ href: "/comprobantes", texto: "Comprobantes" }, { texto: "Nuevo" }]} />
      <Encabezado
        titulo="Nuevo comprobante"
        descripcion="Se guarda como borrador hasta autorizarlo en ARCA (o emitirlo, si es X)."
      />
      {contexto.puntosVenta.length === 0 && (
        <div role="alert" className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No hay ningún punto de venta activo: agregalo en Configuración → ARCA.
        </div>
      )}
      <EditorComprobante comprobante={null} contexto={contexto} precios={precios} hoy={hoyArgentina()} />
    </>
  );
}
