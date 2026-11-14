"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validarBanco } from "@/lib/bancos/validacion";
import { mensajeErrorBanco } from "@/lib/bancos/errores";

/** Estado del formulario de banco: el error se muestra en un modal. */
export type EstadoFormularioBanco = { error?: string } | undefined;

const RUTA = "/configuracion/bancos";

function datos(formData: FormData) {
  return validarBanco({
    nombre: String(formData.get("nombre") ?? ""),
    activo: formData.get("activo") === "on",
  });
}

function refrescar() {
  // El nombre del banco se muestra en cuentas, cheques y recibos.
  revalidatePath("/", "layout");
}

// Next enmascara en producción los errores lanzados desde una acción: las
// acciones de los formularios devuelven el mensaje en lugar de lanzarlo.

export async function crearBanco(_estado: EstadoFormularioBanco, formData: FormData): Promise<EstadoFormularioBanco> {
  const validado = datos(formData);
  if ("error" in validado) return { error: validado.error };
  const supabase = await createClient();
  const { error } = await supabase.from("banco").insert(validado.datos);
  if (error) return { error: mensajeErrorBanco("crear", error) };
  refrescar();
  redirect(RUTA);
}

export async function actualizarBanco(
  _estado: EstadoFormularioBanco,
  formData: FormData,
): Promise<EstadoFormularioBanco> {
  const validado = datos(formData);
  if ("error" in validado) return { error: validado.error };
  const supabase = await createClient();
  const { error } = await supabase
    .from("banco")
    .update(validado.datos)
    .eq("id", String(formData.get("id")));
  if (error) return { error: mensajeErrorBanco("actualizar", error) };
  refrescar();
  redirect(RUTA);
}

/** Activa o desactiva un banco desde la lista. */
export async function cambiarEstadoBanco(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("banco")
    .update({ activo: formData.get("activo") === "true" })
    .eq("id", String(formData.get("id")));
  // Sin estado de formulario: el error se avisa en la página con ?aviso=.
  if (error?.code === "23505") redirect(`${RUTA}?aviso=duplicado`);
  if (error) redirect(`${RUTA}?aviso=no-guardado`);
  refrescar();
  redirect(RUTA);
}
