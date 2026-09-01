"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";

function refrescar(productoId?: string) {
  revalidatePath("/");
  revalidatePath("/productos");
  if (productoId) revalidatePath(`/productos/${productoId}`);
}

// ----- Producto -------------------------------------------------------

function datosProducto(formData: FormData) {
  return {
    codigo: String(formData.get("codigo") ?? "").trim(),
    nombre: String(formData.get("nombre") ?? "").trim(),
    tipo: String(formData.get("tipo") ?? "TERMINADO"),
    descripcion: aTexto(formData.get("descripcion")),
    unidad_id: aTexto(formData.get("unidad_id")),
    activo: formData.get("activo") === "on",
  };
}

export async function crearProducto(formData: FormData) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("producto")
    .insert(datosProducto(formData))
    .select("id")
    .single();
  if (error) throw new Error(`No se pudo crear el producto: ${error.message}`);
  refrescar();
  redirect(`/productos/${data.id}`);
}

export async function actualizarProducto(formData: FormData) {
  const id = String(formData.get("id"));
  const supabase = await createClient();
  const { error } = await supabase.from("producto").update(datosProducto(formData)).eq("id", id);
  if (error) throw new Error(`No se pudo actualizar el producto: ${error.message}`);
  refrescar(id);
}

export async function eliminarProducto(formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase.from("producto").delete().eq("id", String(formData.get("id")));
  if (error) {
    throw new Error(
      `No se pudo eliminar. Si es un subgrupo, puede estar usado en otro producto. Detalle: ${error.message}`,
    );
  }
  refrescar();
  redirect("/productos");
}

export async function duplicarProducto(formData: FormData) {
  const origenId = String(formData.get("id"));
  const supabase = await createClient();

  const { data: original, error: errorOriginal } = await supabase
    .from("producto")
    .select("*")
    .eq("id", origenId)
    .single();
  if (errorOriginal || !original) throw new Error("No se encontró el producto a duplicar.");

  const { data: copia, error: errorCopia } = await supabase
    .from("producto")
    .insert({
      codigo: `${original.codigo}-COPIA`,
      nombre: `${original.nombre} (copia)`,
      tipo: original.tipo,
      descripcion: original.descripcion,
      unidad_id: original.unidad_id,
      activo: false,
    })
    .select("id")
    .single();
  if (errorCopia || !copia) throw new Error(`No se pudo duplicar: ${errorCopia?.message}`);

  const { data: componentes } = await supabase
    .from("producto_componente")
    .select("tipo, materia_prima_id, subgrupo_id, cantidad, merma_pct, orden, notas")
    .eq("producto_id", origenId);
  if (componentes?.length) {
    await supabase
      .from("producto_componente")
      .insert(componentes.map((c) => ({ ...c, producto_id: copia.id })));
  }

  const { data: procesos } = await supabase
    .from("producto_proceso")
    .select("proceso_id, orden, modo, minutos, categoria_mano_obra_id, costo_fijo, cantidad_por_ciclo, notas")
    .eq("producto_id", origenId);
  if (procesos?.length) {
    await supabase.from("producto_proceso").insert(procesos.map((p) => ({ ...p, producto_id: copia.id })));
  }

  refrescar();
  redirect(`/productos/${copia.id}`);
}

// ----- Estructura -----------------------------------------------------

export async function agregarComponente(formData: FormData) {
  const productoId = String(formData.get("producto_id"));
  const tipo = String(formData.get("tipo"));
  const referencia = aTexto(formData.get("referencia_id"));

  if (!referencia) throw new Error("Elegí una materia prima o un subgrupo.");

  const supabase = await createClient();
  const { error } = await supabase.from("producto_componente").insert({
    producto_id: productoId,
    tipo,
    materia_prima_id: tipo === "MATERIA_PRIMA" ? referencia : null,
    subgrupo_id: tipo === "SUBGRUPO" ? referencia : null,
    cantidad: aNumero(formData.get("cantidad"), 1),
    merma_pct: aNumero(formData.get("merma_pct"), 0),
    orden: aNumero(formData.get("orden"), 0),
    notas: aTexto(formData.get("notas")),
  });
  if (error) throw new Error(`No se pudo agregar el componente: ${error.message}`);
  refrescar(productoId);
}

export async function actualizarComponente(formData: FormData) {
  const productoId = String(formData.get("producto_id"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("producto_componente")
    .update({
      cantidad: aNumero(formData.get("cantidad"), 1),
      merma_pct: aNumero(formData.get("merma_pct"), 0),
    })
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo actualizar el componente: ${error.message}`);
  refrescar(productoId);
}

export async function eliminarComponente(formData: FormData) {
  const productoId = String(formData.get("producto_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("producto_componente").delete().eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar el componente: ${error.message}`);
  refrescar(productoId);
}

// ----- Procesos -------------------------------------------------------

export async function agregarProcesoAProducto(formData: FormData) {
  const productoId = String(formData.get("producto_id"));
  const modo = String(formData.get("modo"));
  const supabase = await createClient();

  const { error } = await supabase.from("producto_proceso").insert({
    producto_id: productoId,
    proceso_id: String(formData.get("proceso_id")),
    orden: aNumero(formData.get("orden"), 0),
    modo,
    minutos: modo === "TIEMPO" ? aNumero(formData.get("minutos"), 0) : null,
    categoria_mano_obra_id: modo === "TIEMPO" ? aTexto(formData.get("categoria_mano_obra_id")) : null,
    costo_fijo: modo === "FIJO" ? aNumero(formData.get("costo_fijo"), 0) : null,
    cantidad_por_ciclo: aNumero(formData.get("cantidad_por_ciclo"), 1),
    notas: aTexto(formData.get("notas")),
  });
  if (error) throw new Error(`No se pudo agregar el proceso: ${error.message}`);
  refrescar(productoId);
}

export async function actualizarProcesoDeProducto(formData: FormData) {
  const productoId = String(formData.get("producto_id"));
  const modo = String(formData.get("modo"));
  const supabase = await createClient();

  const { error } = await supabase
    .from("producto_proceso")
    .update({
      minutos: modo === "TIEMPO" ? aNumero(formData.get("minutos"), 0) : null,
      categoria_mano_obra_id: modo === "TIEMPO" ? aTexto(formData.get("categoria_mano_obra_id")) : null,
      costo_fijo: modo === "FIJO" ? aNumero(formData.get("costo_fijo"), 0) : null,
      cantidad_por_ciclo: aNumero(formData.get("cantidad_por_ciclo"), 1),
    })
    .eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo actualizar el proceso: ${error.message}`);
  refrescar(productoId);
}

export async function eliminarProcesoDeProducto(formData: FormData) {
  const productoId = String(formData.get("producto_id"));
  const supabase = await createClient();
  const { error } = await supabase.from("producto_proceso").delete().eq("id", String(formData.get("id")));
  if (error) throw new Error(`No se pudo eliminar el proceso: ${error.message}`);
  refrescar(productoId);
}
