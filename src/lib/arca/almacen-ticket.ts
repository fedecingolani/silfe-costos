/**
 * AlmacenTicket sobre Supabase: lee y guarda el ticket de acceso de WSAA
 * en arca_credencial y toma el bloqueo corto con un update condicional.
 * Lo usan la pantalla de ARCA y la autorización de comprobantes. Sólo para
 * el servidor: maneja el ticket cifrado.
 */
import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { AmbienteArca } from "@/lib/tipos";
import type { AlmacenTicket } from "./acceso";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export function almacenTicket(supabase: Supabase, ambiente: AmbienteArca): AlmacenTicket {
  const tabla = () => supabase.from("arca_credencial");
  const almacen: AlmacenTicket = {
    async leer() {
      const { data, error } = await tabla()
        .select("ta_cifrado, ta_expira, ta_bloqueado_hasta")
        .eq("ambiente", ambiente)
        .single();
      if (error || !data) throw new Error(`No se pudo leer el ticket de acceso: ${error?.message ?? "sin datos"}`);
      return { taCifrado: data.ta_cifrado, taExpira: data.ta_expira, taBloqueadoHasta: data.ta_bloqueado_hasta };
    },
    async tomarBloqueo(hasta, ahora) {
      // Update condicional: sólo gana quien encuentra el bloqueo libre o vencido.
      const { data, error } = await tabla()
        .update({ ta_bloqueado_hasta: hasta.toISOString() })
        .eq("ambiente", ambiente)
        .or(`ta_bloqueado_hasta.is.null,ta_bloqueado_hasta.lt.${ahora.toISOString()}`)
        .select("ambiente");
      if (error) throw new Error(`No se pudo reservar el pedido de ticket: ${error.message}`);
      if ((data ?? []).length === 1) return true;
      // Cero filas: sólo es "otro pedido tiene el bloqueo" si el bloqueo está tomado y vigente.
      // Si está libre, el update falló por otra causa (RLS, fila inexistente) y hay que decirlo.
      const actual = await almacen.leer();
      const bloqueado = actual.taBloqueadoHasta !== null && new Date(actual.taBloqueadoHasta) >= ahora;
      if (!bloqueado) throw new Error("No se pudo reservar el pedido de ticket: no se actualizó ningún registro.");
      return false;
    },
    async guardar(taCifrado, expira) {
      const { data, error } = await tabla()
        .update({ ta_cifrado: taCifrado, ta_expira: expira.toISOString(), ta_bloqueado_hasta: null })
        .eq("ambiente", ambiente)
        .select("ambiente");
      if (error) throw new Error(`No se pudo guardar el ticket de acceso: ${error.message}`);
      if ((data ?? []).length !== 1) {
        throw new Error("No se pudo guardar el ticket de acceso: no se actualizó ningún registro.");
      }
    },
    async liberarBloqueo(hasta) {
      await tabla()
        .update({ ta_bloqueado_hasta: null })
        .eq("ambiente", ambiente)
        .eq("ta_bloqueado_hasta", hasta.toISOString());
    },
  };
  return almacen;
}
