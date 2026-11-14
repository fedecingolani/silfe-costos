"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validarMotivoAnulacion } from "@/lib/cobranzas/anulacion";
import { validarAjuste } from "@/lib/finanzas/ajustes";
import { esTipoCuentaFondos, PANTALLA_CUENTAS, validarCuenta } from "@/lib/finanzas/cuentas";
import { mensajeErrorFinanzas, mensajeErrorTransferencia } from "@/lib/finanzas/errores";
import { validarTransferencia } from "@/lib/finanzas/transferencias";
import type { TipoCuentaFondos } from "@/lib/tipos";

// Next enmascara en producción los errores lanzados desde una acción: las
// acciones devuelven el mensaje en lugar de lanzarlo.

/** Estado de los formularios de cuenta (con modal de error). */
export type EstadoFormularioCuenta = { error?: string } | undefined;

export type ResultadoFinanzas = { error?: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(formData: FormData, campo: string): string | null {
  const valor = formData.get(campo);
  return valor === null ? null : String(valor);
}

function leerTipo(formData: FormData): TipoCuentaFondos | null {
  const tipo = texto(formData, "tipo");
  return esTipoCuentaFondos(tipo) ? tipo : null;
}

function datosCuenta(formData: FormData) {
  const tipo = leerTipo(formData);
  if (!tipo) return { error: "El tipo de cuenta no es válido." };
  return validarCuenta(tipo, {
    nombre: texto(formData, "nombre"),
    banco: texto(formData, "banco"),
    numero_cuenta: texto(formData, "numero_cuenta"),
    cbu: texto(formData, "cbu"),
    alias: texto(formData, "alias"),
    observacion: texto(formData, "observacion"),
    activa: formData.get("activa") === "on",
  });
}

/**
 * El tipo de la cuenta de un ajuste, leído de la base al escribirlo: las
 * rutas que se refrescan no dependen del tipo que manda el cliente.
 */
const CON_TIPO_DE_CUENTA = "id, cuenta:cuenta_fondos(tipo)";
type FilaConTipo = { id: string; cuenta: { tipo: string } | null };

function tipoDeLaFila(fila: FilaConTipo | undefined, pedido: TipoCuentaFondos): TipoCuentaFondos {
  const tipo = fila?.cuenta?.tipo;
  return esTipoCuentaFondos(tipo) ? tipo : pedido;
}

function refrescar(tipo: TipoCuentaFondos, id?: string) {
  const { ruta } = PANTALLA_CUENTAS[tipo];
  revalidatePath(ruta);
  if (id) revalidatePath(`${ruta}/${id}`);
}

export async function crearCuenta(
  _estado: EstadoFormularioCuenta,
  formData: FormData,
): Promise<EstadoFormularioCuenta> {
  const entrada = datosCuenta(formData);
  if ("error" in entrada) return { error: entrada.error };
  const supabase = await createClient();
  const { data, error } = await supabase.from("cuenta_fondos").insert(entrada.datos).select("id").single();
  if (error) return { error: mensajeErrorFinanzas(error, "crear la cuenta") };
  refrescar(entrada.datos.tipo);
  redirect(`${PANTALLA_CUENTAS[entrada.datos.tipo].ruta}/${data.id}`);
}

/** El tipo no cambia (lo impide la base): se filtra por él para no tocar una cuenta de la otra pantalla. */
export async function actualizarCuenta(
  _estado: EstadoFormularioCuenta,
  formData: FormData,
): Promise<EstadoFormularioCuenta> {
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return { error: "Cuenta inválida." };
  const entrada = datosCuenta(formData);
  if ("error" in entrada) return { error: entrada.error };
  const { tipo, ...cambios } = entrada.datos;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cuenta_fondos")
    .update(cambios)
    .eq("id", id)
    .eq("tipo", tipo)
    .select("id");
  if (error) return { error: mensajeErrorFinanzas(error, "actualizar la cuenta") };
  if (!data?.length) return { error: "La cuenta ya no existe. Recargue la página." };
  refrescar(tipo, id);
  redirect(`${PANTALLA_CUENTAS[tipo].ruta}/${id}`);
}

export async function registrarAjuste(
  cuentaId: string,
  tipoCuenta: TipoCuentaFondos,
  formData: FormData,
): Promise<ResultadoFinanzas> {
  if (!UUID.test(cuentaId) || !esTipoCuentaFondos(tipoCuenta)) return { error: "Cuenta inválida." };
  const entrada = validarAjuste({
    fecha: texto(formData, "fecha"),
    tipo: texto(formData, "tipo"),
    importe: texto(formData, "importe"),
    concepto: texto(formData, "concepto"),
    observacion: texto(formData, "observacion"),
  });
  if ("error" in entrada) return { error: entrada.error };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ajuste_fondos")
    .insert({ ...entrada.datos, cuenta_id: cuentaId })
    .select(CON_TIPO_DE_CUENTA)
    .returns<FilaConTipo[]>();
  if (error) return { error: mensajeErrorFinanzas(error, "registrar el ajuste") };
  refrescar(tipoDeLaFila(data?.[0], tipoCuenta), cuentaId);
  return {};
}

/** Anula un ajuste vigente; el trigger pone la fecha de anulación. */
export async function anularAjuste(
  ajusteId: string,
  cuentaId: string,
  tipoCuenta: TipoCuentaFondos,
  motivo: string,
): Promise<ResultadoFinanzas> {
  if (!UUID.test(ajusteId) || !UUID.test(cuentaId) || !esTipoCuentaFondos(tipoCuenta)) {
    return { error: "Ajuste inválido." };
  }
  const errorMotivo = validarMotivoAnulacion(motivo);
  if (errorMotivo) return { error: errorMotivo };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ajuste_fondos")
    .update({ estado: "anulado", motivo_anulacion: motivo.trim() })
    .eq("id", ajusteId)
    .eq("cuenta_id", cuentaId)
    .eq("estado", "vigente")
    .select(CON_TIPO_DE_CUENTA)
    .returns<FilaConTipo[]>();
  if (error) return { error: mensajeErrorFinanzas(error, "anular el ajuste") };
  if (!data?.length) return { error: "El ajuste ya estaba anulado o no existe. Recargue la página." };
  refrescar(tipoDeLaFila(data[0], tipoCuenta), cuentaId);
  return {};
}

/** Una transferencia toca dos cuentas, de cualquier tipo: se refrescan las dos pantallas. */
function refrescarTransferencia(...ids: string[]) {
  for (const { ruta } of Object.values(PANTALLA_CUENTAS)) {
    revalidatePath(ruta);
    for (const id of ids) revalidatePath(`${ruta}/${id}`);
  }
}

/** Registra una transferencia desde la cuenta de la pantalla (origen) a la elegida (destino). */
export async function registrarTransferencia(cuentaOrigenId: string, formData: FormData): Promise<ResultadoFinanzas> {
  if (!UUID.test(cuentaOrigenId)) return { error: "Cuenta inválida." };
  const entrada = validarTransferencia(cuentaOrigenId, {
    fecha: texto(formData, "fecha"),
    cuenta_destino_id: texto(formData, "cuenta_destino_id"),
    importe: texto(formData, "importe"),
    concepto: texto(formData, "concepto"),
    observacion: texto(formData, "observacion"),
  });
  if ("error" in entrada) return { error: entrada.error };
  const supabase = await createClient();
  const { error } = await supabase.from("transferencia_fondos").insert(entrada.datos);
  if (error) return { error: mensajeErrorTransferencia(error, "registrar la transferencia") };
  refrescarTransferencia(entrada.datos.cuenta_origen_id, entrada.datos.cuenta_destino_id);
  return {};
}

/** Anula una transferencia vigente desde cualquiera de sus dos cuentas; el trigger pone la fecha de anulación. */
export async function anularTransferencia(
  transferenciaId: string,
  cuentaId: string,
  motivo: string,
): Promise<ResultadoFinanzas> {
  if (!UUID.test(transferenciaId) || !UUID.test(cuentaId)) return { error: "Transferencia inválida." };
  const errorMotivo = validarMotivoAnulacion(motivo);
  if (errorMotivo) return { error: errorMotivo };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("transferencia_fondos")
    .update({ estado: "anulado", motivo_anulacion: motivo.trim() })
    .eq("id", transferenciaId)
    .or(`cuenta_origen_id.eq.${cuentaId},cuenta_destino_id.eq.${cuentaId}`)
    .eq("estado", "vigente")
    .select("cuenta_origen_id, cuenta_destino_id");
  if (error) return { error: mensajeErrorTransferencia(error, "anular la transferencia") };
  if (!data?.length) return { error: "La transferencia ya estaba anulada o no existe. Recargue la página." };
  refrescarTransferencia(data[0].cuenta_origen_id as string, data[0].cuenta_destino_id as string);
  return {};
}
