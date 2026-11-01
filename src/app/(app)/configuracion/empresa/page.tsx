import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta } from "@/components/ui";
import { guardarEmpresa } from "./acciones";
import { FormularioEmpresa, type EmpresaFormulario } from "./FormularioEmpresa";

export const dynamic = "force-dynamic";

export default async function EmpresaPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("empresa")
    .select("nombre_fantasia, color_marca, telefono, email, web, logo_base64, logo_tipo")
    .eq("id", true)
    .maybeSingle();
  if (error) {
    return <p className="text-sm text-red-700">Error al cargar los datos de la empresa: {error.message}</p>;
  }

  const fila = data as (Omit<EmpresaFormulario, "logo"> & { logo_base64: string | null; logo_tipo: string | null }) | null;
  const empresa: EmpresaFormulario | null = fila && {
    nombre_fantasia: fila.nombre_fantasia,
    color_marca: fila.color_marca,
    telefono: fila.telefono,
    email: fila.email,
    web: fila.web,
    logo: fila.logo_base64 && fila.logo_tipo ? `data:${fila.logo_tipo};base64,${fila.logo_base64}` : null,
  };

  return (
    <>
      <Encabezado
        titulo="Empresa"
        descripcion="Nombre, logo, color y contacto de la empresa. Se muestran en el menú y en los PDF. Los datos fiscales se cargan en ARCA."
      />
      <div className="max-w-xl">
        <Tarjeta titulo="Identidad">
          <FormularioEmpresa accion={guardarEmpresa} empresa={empresa} />
        </Tarjeta>
      </div>
    </>
  );
}
