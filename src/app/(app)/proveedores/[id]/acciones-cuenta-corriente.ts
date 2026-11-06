"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { textoPesos } from "@/lib/cobranzas/dinero";
import { mensajeErrorOrdenPago } from "@/lib/compras/pagos/errores";

// Como en cobranzas: las acciones devuelven el mensaje en lugar de lanzarlo.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Aplica el saldo a favor del proveedor (órdenes de pago y notas de crédito
 * con algo sin imputar) a un débito pendiente, del crédito más viejo al más
 * nuevo (aplicar_saldo_a_favor_compra).
 */
export async function aplicarSaldoAFavor(
  proveedorId: string,
  comprobanteId: string,
): Promise<{ error?: string; ok?: string }> {
  if (!UUID.test(proveedorId) || !UUID.test(comprobanteId)) return { error: "Comprobante inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("aplicar_saldo_a_favor_compra", { p_comprobante_compra_id: comprobanteId });
  if (error) return { error: mensajeErrorOrdenPago(error, "aplicar el saldo a favor") };
  revalidatePath(`/proveedores/${proveedorId}`);
  revalidatePath("/compras/cuentas-corrientes");
  revalidatePath("/compras/comprobantes");
  revalidatePath(`/compras/comprobantes/${comprobanteId}`);
  return { ok: `Se aplicaron ${textoPesos(Number(data))} del saldo a favor.` };
}
