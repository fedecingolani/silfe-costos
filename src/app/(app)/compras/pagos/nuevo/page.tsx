import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { imputacionInicial } from "@/lib/compras/pagos/imputacion";
import {
  cargarCartera,
  cargarCuentaProveedor,
  cargarCuentasPago,
  cargarProveedores,
  type CuentaProveedor,
} from "../datos";
import { EditorOrdenPago } from "../EditorOrdenPago";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Nueva orden de pago. Con ?proveedor=<id> llega con el proveedor elegido;
 * con además ?comprobante=<id> («Pagar» desde el comprobante) precarga su
 * saldo como imputación y como importe del primer medio.
 */
export default async function NuevaOrdenPagoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const proveedorParam = typeof parametros.proveedor === "string" ? parametros.proveedor : null;
  const comprobanteParam = typeof parametros.comprobante === "string" ? parametros.comprobante : null;
  const supabase = await createClient();

  const [proveedores, cartera, cuentas] = await Promise.all([
    cargarProveedores(supabase),
    cargarCartera(supabase),
    cargarCuentasPago(supabase),
  ]);
  if (typeof proveedores === "string") return <p className="text-sm text-red-700">{proveedores}</p>;
  if (typeof cartera === "string") return <p className="text-sm text-red-700">{cartera}</p>;
  if (typeof cuentas === "string") return <p className="text-sm text-red-700">{cuentas}</p>;

  let proveedorInicial: string | null = null;
  let cuentaInicial: CuentaProveedor | null = null;
  let aImputarInicial: Record<string, string> = {};
  if (proveedorParam && UUID.test(proveedorParam) && proveedores.some((p) => p.id === proveedorParam && p.activo)) {
    const cuenta = await cargarCuentaProveedor(supabase, proveedorParam);
    if (typeof cuenta !== "string") {
      proveedorInicial = proveedorParam;
      cuentaInicial = cuenta;
      aImputarInicial = imputacionInicial(cuenta.debitos, comprobanteParam && UUID.test(comprobanteParam) ? comprobanteParam : null);
    }
  }
  const importeInicial = Object.values(aImputarInicial).map(Number)[0] ?? null;

  return (
    <>
      <Migas items={[{ href: "/compras/pagos", texto: "Pagos" }, { texto: "Nueva" }]} />
      <Encabezado
        titulo="Nueva orden de pago"
        descripcion="Se guarda como borrador hasta confirmarla: al confirmarla toma número, entrega sus cheques y no se modifica más."
      />
      <EditorOrdenPago
        orden={null}
        proveedores={proveedores}
        cartera={cartera}
        cuentas={cuentas}
        cuentaInicial={cuentaInicial}
        proveedorInicial={proveedorInicial}
        aImputarInicial={aImputarInicial}
        importeInicial={importeInicial}
        hoy={hoyArgentina()}
      />
    </>
  );
}
