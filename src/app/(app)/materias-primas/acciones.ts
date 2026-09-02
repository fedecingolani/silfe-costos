"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";

function mensajeCodigoDuplicado(codigo: string, error: { code?: string; message: string }) {
  if (error.code === "23505") {
    return `Ya existe una materia prima con el código "${codigo}".`;
  }
  return null;
}

export type EstadoFormularioMateriaPrima = { error?: string } | undefined;

function datosMateriaPrima(formData: FormData) {
  return {
    codigo: String(formData.get("codigo") ?? "").trim(),
    nombre: String(formData.get("nombre") ?? "").trim(),
    categoria: aTexto(formData.get("categoria")),
    unidad_compra_id: String(formData.get("unidad_compra_id")),
    unidad_uso_id: String(formData.get("unidad_uso_id")),
    factor_conversion: aNumero(formData.get("factor_conversion"), 1),
    merma_pct: aNumero(formData.get("merma_pct"), 0),
    notas: aTexto(formData.get("notas")),
    activo: formData.get("activo") === "on",
  };
}

export async function crearMateriaPrima(
  _estado: EstadoFormularioMateriaPrima,
  formData: FormData,
): Promise<EstadoFormularioMateriaPrima> {
  const supabase = await createClient();
  const datos = datosMateriaPrima(formData);
  const { data, error } = await supabase.from("materia_prima").insert(datos).select("id").single();
  if (error) {
    return { error: mensajeCodigoDuplicado(datos.codigo, error) ?? `No se pudo crear la materia prima: ${error.message}` };
  }

  // Precio inicial opcional
  const precio = aNumero(formData.get("precio"));
  if (precio !== null && data) {
    const proveedorId = aTexto(formData.get("proveedor_id"));
    const { error: errorPrecio } = await supabase.from("precio_materia_prima").insert({
      materia_prima_id: data.id,
      proveedor_id: proveedorId,
      precio,
      es_preferido: true,
    });
    if (errorPrecio) {
      revalidatePath("/materias-primas");
      revalidatePath("/productos");
      return { error: `Materia prima creada, pero falló el precio: ${errorPrecio.message}` };
    }
  }

  revalidatePath("/materias-primas");
  revalidatePath("/productos");
}

export async function actualizarMateriaPrima(
  _estado: EstadoFormularioMateriaPrima,
  formData: FormData,
): Promise<EstadoFormularioMateriaPrima> {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const datos = datosMateriaPrima(formData);
  const { error } = await supabase.from("materia_prima").update(datos).eq("id", id);
  if (error) {
    return { error: mensajeCodigoDuplicado(datos.codigo, error) ?? `No se pudo actualizar la materia prima: ${error.message}` };
  }
  revalidatePath("/materias-primas");
  revalidatePath(`/materias-primas/${id}`);
  revalidatePath("/productos");
}

export async function eliminarMateriaPrima(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("materia_prima").delete().eq("id", String(formData.get("id")));
  if (error) {
    throw new Error(
      `No se pudo eliminar. Probablemente se use en algún producto. Detalle: ${error.message}`,
    );
  }
  revalidatePath("/materias-primas");
  redirect("/materias-primas");
}

export async function agregarPrecio(formData: FormData) {
  const materiaPrimaId = String(formData.get("materia_prima_id"));
  const esPreferido = formData.get("es_preferido") === "on";
  const supabase = await createClient();

  if (esPreferido) {
    await supabase
      .from("precio_materia_prima")
      .update({ es_preferido: false })
      .eq("materia_prima_id", materiaPrimaId)
      .eq("es_preferido", true);
  }

  const { error } = await supabase.from("precio_materia_prima").insert({
    materia_prima_id: materiaPrimaId,
    proveedor_id: aTexto(formData.get("proveedor_id")),
    precio: aNumero(formData.get("precio"), 0),
    incluye_iva: formData.get("incluye_iva") === "on",
    vigente_desde: aTexto(formData.get("vigente_desde")) ?? undefined,
    es_preferido: esPreferido,
    observaciones: aTexto(formData.get("observaciones")),
  });
  if (error) throw new Error(`No se pudo agregar el precio: ${error.message}`);

  revalidatePath(`/materias-primas/${materiaPrimaId}`);
  revalidatePath("/materias-primas");
  revalidatePath("/productos");
}

export async function marcarPreferido(formData: FormData) {
  const materiaPrimaId = String(formData.get("materia_prima_id"));
  const precioId = String(formData.get("precio_id"));
  const supabase = await createClient();

  await supabase
    .from("precio_materia_prima")
    .update({ es_preferido: false })
    .eq("materia_prima_id", materiaPrimaId)
    .eq("es_preferido", true);

  const { error } = await supabase
    .from("precio_materia_prima")
    .update({ es_preferido: true })
    .eq("id", precioId);
  if (error) throw new Error(`No se pudo marcar el precio: ${error.message}`);

  revalidatePath(`/materias-primas/${materiaPrimaId}`);
  revalidatePath("/materias-primas");
  revalidatePath("/productos");
}

export async function eliminarPrecio(formData: FormData) {
  const materiaPrimaId = String(formData.get("materia_prima_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("precio_materia_prima")
    .delete()
    .eq("id", String(formData.get("precio_id")));
  if (error) throw new Error(`No se pudo eliminar el precio: ${error.message}`);
  revalidatePath(`/materias-primas/${materiaPrimaId}`);
  revalidatePath("/materias-primas");
  revalidatePath("/productos");
}
