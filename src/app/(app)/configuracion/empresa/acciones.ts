"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validarDatosEmpresa, validarLogo, type TipoLogo } from "@/lib/empresa/validacion";

/** Estado del formulario de la empresa (useActionState). */
export type EstadoFormularioEmpresa = { error?: string; ok?: string } | undefined;

function texto(valor: FormDataEntryValue | null): string | null {
  return typeof valor === "string" ? valor : null;
}

export async function guardarEmpresa(
  _estado: EstadoFormularioEmpresa,
  formData: FormData,
): Promise<EstadoFormularioEmpresa> {
  const validacion = validarDatosEmpresa({
    nombre_fantasia: texto(formData.get("nombre_fantasia")),
    color_marca: texto(formData.get("color_marca")),
    telefono: texto(formData.get("telefono")),
    email: texto(formData.get("email")),
    web: texto(formData.get("web")),
  });
  if ("error" in validacion) return { error: validacion.error };

  // Sin archivo nuevo el logo queda como está, salvo que se pida quitarlo.
  let logo: { logo_base64: string | null; logo_tipo: TipoLogo | null } | undefined;
  const archivo = formData.get("logo");
  if (archivo instanceof File && archivo.size > 0) {
    const resultado = validarLogo(new Uint8Array(await archivo.arrayBuffer()));
    if ("error" in resultado) return { error: resultado.error };
    logo = { logo_base64: resultado.base64, logo_tipo: resultado.tipo };
  } else if (formData.get("quitar_logo") === "on") {
    logo = { logo_base64: null, logo_tipo: null };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("empresa")
    .update({ ...validacion.datos, ...logo })
    .eq("id", true)
    .select("id");
  if (error) return { error: `No se pudieron guardar los datos de la empresa: ${error.message}` };
  // Sin filas actualizadas (fila única ausente o RLS) no hay que informar éxito.
  if ((data ?? []).length !== 1) {
    return { error: "No se pudieron guardar los datos de la empresa: no se actualizó ningún registro." };
  }
  // El nombre, el logo y el color se muestran en el menú de todas las pantallas.
  revalidatePath("/", "layout");
  return { ok: "Datos de la empresa guardados." };
}
