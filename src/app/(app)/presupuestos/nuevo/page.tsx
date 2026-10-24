import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { cargarContextoEditor, cargarPrecios } from "../../comprobantes/datos";
import { EditorPresupuesto } from "../EditorPresupuesto";

export const dynamic = "force-dynamic";

export default async function NuevoPresupuestoPage() {
  const supabase = await createClient();
  const contexto = await cargarContextoEditor(supabase);
  if (typeof contexto === "string") {
    return <p className="text-sm text-red-700">Error al cargar los datos del presupuesto: {contexto}</p>;
  }
  // Por defecto, la lista creada más recientemente (la primera).
  const precios = await cargarPrecios(supabase, contexto.listas[0]?.id ?? null);

  return (
    <>
      <Migas items={[{ href: "/presupuestos", texto: "Presupuestos" }, { texto: "Nuevo" }]} />
      <Encabezado titulo="Nuevo presupuesto" descripcion="El número se asigna al guardarlo." />
      <EditorPresupuesto presupuesto={null} contexto={contexto} precios={precios} hoy={hoyArgentina()} />
    </>
  );
}
