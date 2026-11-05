import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas } from "@/components/ui";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { notaDesdeParametros, puedeTenerNotas } from "@/lib/compras/comprobantes/nota";
import { NOMBRES_TIPO_COMPROBANTE_COMPRA, numeroComprobanteCompra } from "@/lib/compras/comprobantes/numero";
import {
  cargarArticulos,
  cargarComprobanteCompra,
  cargarContextoEditorCompra,
  cargarFacturasAsociables,
  type ComprobanteCompraCargado,
} from "../datos";
import { EditorComprobanteCompra } from "../EditorComprobanteCompra";

export const dynamic = "force-dynamic";

/**
 * Comprobante nuevo. Con ?desde=<factura>&tipo=nota_credito|nota_debito es
 * una nota asociada a esa factura (confirmada), con sus renglones y precios;
 * si los parámetros no sirven, es un comprobante nuevo común.
 */
export default async function NuevoComprobanteCompraPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  const pedido = notaDesdeParametros(parametros.desde, parametros.tipo);
  const supabase = await createClient();
  const contexto = await cargarContextoEditorCompra(supabase);
  if (typeof contexto === "string") {
    return <p className="text-sm text-red-700">Error al cargar los datos del comprobante: {contexto}</p>;
  }

  let factura: ComprobanteCompraCargado | null = null;
  if (pedido) {
    const cargada = await cargarComprobanteCompra(supabase, pedido.facturaId);
    if (cargada && typeof cargada !== "string" && puedeTenerNotas(cargada.comprobante)) factura = cargada;
  }

  if (pedido && factura) {
    const f = factura.comprobante;
    const [articulos, facturas] = await Promise.all([
      cargarArticulos(supabase, f.proveedor_id),
      cargarFacturasAsociables(supabase, f.proveedor_id, f.letra),
    ]);
    if (typeof articulos === "string" || typeof facturas === "string") {
      const error = typeof articulos === "string" ? articulos : facturas;
      return <p className="text-sm text-red-700">Error al cargar los datos del comprobante: {error as string}</p>;
    }
    const nombre = NOMBRES_TIPO_COMPROBANTE_COMPRA[pedido.tipo];
    return (
      <>
        <Migas items={[{ href: "/compras/comprobantes", texto: "Comprobantes de compra" }, { texto: "Nuevo" }]} />
        <Encabezado
          titulo={`Nueva ${nombre.toLowerCase()}`}
          descripcion={`Asociada a la factura ${numeroComprobanteCompra(f)}. Trae sus renglones y precios: ajustá las cantidades e importes de la nota. No actualiza precios de materias primas.`}
        />
        <EditorComprobanteCompra
          guardado={null}
          notaDe={{ factura, tipo: pedido.tipo }}
          contexto={contexto}
          articulos={articulos}
          facturas={facturas}
          hoy={hoyArgentina()}
        />
      </>
    );
  }

  return (
    <>
      <Migas items={[{ href: "/compras/comprobantes", texto: "Comprobantes de compra" }, { texto: "Nuevo" }]} />
      <Encabezado
        titulo="Nuevo comprobante de compra"
        descripcion="Factura, nota de crédito o de débito de un proveedor. Se guarda como borrador hasta confirmarlo."
      />
      <EditorComprobanteCompra guardado={null} contexto={contexto} articulos={[]} hoy={hoyArgentina()} />
    </>
  );
}
