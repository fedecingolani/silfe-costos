import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { cargarContextoEditor, cargarPrecios } from "../../comprobantes/datos";
import { cargarTransportes } from "../datos";
import { EditorRemito } from "../EditorRemito";

export const dynamic = "force-dynamic";

export default async function NuevoRemitoPage() {
  const supabase = await createClient();
  const [contexto, transportes] = await Promise.all([cargarContextoEditor(supabase), cargarTransportes(supabase)]);
  if (typeof contexto === "string" || typeof transportes === "string") {
    const error = typeof contexto === "string" ? contexto : transportes;
    return <p className="text-sm text-red-700">Error al cargar los datos del remito: {error as string}</p>;
  }
  // Por defecto, la lista creada más recientemente (la primera).
  const precios = await cargarPrecios(supabase, contexto.listas[0]?.id ?? null);

  return (
    <>
      <Migas items={[{ href: "/remitos", texto: "Remitos" }, { texto: "Nuevo" }]} />
      <Encabezado
        titulo="Nuevo remito"
        descripcion="Se guarda como borrador; el número se asigna al emitirlo."
      />
      <EditorRemito remito={null} contexto={contexto} transportes={transportes} precios={precios} hoy={hoyArgentina()} />
    </>
  );
}
