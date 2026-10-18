import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { nombreComprobante } from "@/lib/comprobantes/listado";
import type { ClienteEncontrado } from "../../comprobantes/acciones";
import { cargarComprobanteContado, cargarDebitos, reciboDeContado, type CuentaCliente } from "../datos";
import { EditorRecibo, type ContadoAPagar } from "../EditorRecibo";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Nueva cobranza de cuenta corriente o, con ?contado=<comprobante>, el pago
 * de una factura o ND de contado. Si ese pago ya tiene un borrador (o ya se
 * emitió), abre ese recibo en lugar de crear otro.
 */
export default async function NuevaCobranzaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const contadoId = typeof parametros.contado === "string" ? parametros.contado : null;
  const clienteId = typeof parametros.cliente === "string" ? parametros.cliente : null;
  const supabase = await createClient();

  let contado: ContadoAPagar | null = null;
  if (contadoId !== null) {
    if (!UUID.test(contadoId)) return <p className="text-sm text-red-700">Comprobante inválido.</p>;
    const existentes = await reciboDeContado(supabase, contadoId);
    if (typeof existentes === "string") return <p className="text-sm text-red-700">{existentes}</p>;
    if (existentes.length > 0) redirect(`/cobranzas/${existentes[0].id}`);

    const c = await cargarComprobanteContado(supabase, contadoId);
    if (typeof c === "string") return <p className="text-sm text-red-700">{c}</p>;
    const { data: cliente, error } = await supabase
      .from("cliente")
      .select("id, razon_social, cuit, condicion_iva, codigo_legado")
      .eq("id", c.clienteId)
      .maybeSingle();
    if (error || !cliente) return <p className="text-sm text-red-700">No se encontró el cliente del comprobante.</p>;
    contado = {
      id: c.id,
      texto: `${nombreComprobante(c.clase, null)} ${c.numeroTexto}`,
      total: c.total,
      cliente: cliente as ClienteEncontrado,
    };
  }

  // Desde la cuenta corriente del cliente: llega con el cliente ya elegido.
  let clienteInicial: ClienteEncontrado | null = null;
  let cuentaInicial: CuentaCliente | null = null;
  if (!contado && clienteId !== null && UUID.test(clienteId)) {
    const { data } = await supabase
      .from("cliente")
      .select("id, razon_social, cuit, condicion_iva, codigo_legado")
      .eq("id", clienteId)
      .eq("activo", true)
      .maybeSingle();
    if (data) {
      const cuenta = await cargarDebitos(supabase, clienteId);
      if (typeof cuenta !== "string") {
        clienteInicial = data as ClienteEncontrado;
        cuentaInicial = cuenta;
      }
    }
  }

  return (
    <>
      <Migas items={[{ href: "/cobranzas", texto: "Cobranzas" }, { texto: contado ? "Pago de contado" : "Nueva" }]} />
      <Encabezado
        titulo={contado ? "Registrar pago de contado" : "Nueva cobranza"}
        descripcion={
          contado
            ? "El pago es por el total exacto del comprobante. Se guarda como borrador hasta emitir el recibo."
            : "Se guarda como borrador hasta emitir el recibo: al emitirlo toma número y no se modifica más."
        }
      />
      <EditorRecibo
        recibo={null}
        contado={contado}
        clienteInicial={clienteInicial}
        cuentaInicial={cuentaInicial}
        hoy={hoyArgentina()}
      />
    </>
  );
}
