/**
 * API de comprobantes de compra para integraciones (Factura Digital). Ver
 * el contrato en odd/tasks/api-compras.md.
 *
 *   POST /api/v1/comprobantes-compra
 *     → 201 { id, estado: "borrador", creado: true }
 *     → 200 { id, estado, creado: false } si ya estaba (mismo proveedor,
 *       tipo, letra, punto de venta y número, no anulado)
 *     → 422 PROVEEDOR_NO_EXISTE si el CUIT no es de ningún proveedor
 *
 * Siempre crea un borrador: lo confirma una persona después de asociar
 * cada artículo a una materia prima.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { autenticar } from "@/lib/api/autenticar";
import {
  esErrorDeDatos,
  parametrosComprobanteApi,
  validarComprobanteApi,
  type ParametrosComprobanteApi,
} from "@/lib/api/comprobantes-compra";
import { CODIGOS_ERROR, errorApi, errorInterno, leerJson, respuestaJson } from "@/lib/api/respuestas";
import { mensajeErrorComprobanteCompra } from "@/lib/compras/comprobantes/errores";

type Existente = { id: string; estado: string };

async function buscarExistente(supabase: SupabaseClient, p: ParametrosComprobanteApi["p_comprobante"]) {
  return supabase
    .from("comprobante_compra")
    .select("id, estado")
    .eq("proveedor_id", p.proveedor_id)
    .eq("tipo", p.tipo)
    .eq("letra", p.letra)
    .eq("punto_venta", p.punto_venta)
    .eq("numero", p.numero)
    .neq("estado", "anulado")
    .limit(1)
    .returns<Existente[]>();
}

function yaExistia(existente: Existente): Response {
  return respuestaJson({ id: existente.id, estado: existente.estado, creado: false }, 200);
}

export async function POST(request: Request): Promise<Response> {
  const auth = await autenticar(request);
  if (!auth.ok) return auth.respuesta;
  const { supabase } = auth;

  const cuerpo = await leerJson(request);
  if ("respuesta" in cuerpo) return cuerpo.respuesta;

  const validado = validarComprobanteApi(cuerpo.datos);
  if ("errores" in validado) return errorApi(422, CODIGOS_ERROR.VALIDACION, validado.errores.join(" "));

  const proveedor = await supabase.from("proveedor").select("id").eq("cuit", validado.cuit).limit(1).returns<{ id: string }[]>();
  if (proveedor.error) {
    console.error("[api] No se pudo buscar el proveedor", proveedor.error);
    return errorInterno();
  }
  if (!proveedor.data?.length) {
    return errorApi(
      422,
      CODIGOS_ERROR.PROVEEDOR_NO_EXISTE,
      `No hay un proveedor con CUIT ${validado.cuit}. Crealo primero (POST /api/v1/proveedores).`,
    );
  }

  const parametros = parametrosComprobanteApi(validado, proveedor.data[0].id);

  const existente = await buscarExistente(supabase, parametros.p_comprobante);
  if (existente.error) {
    console.error("[api] No se pudo buscar el comprobante", existente.error);
    return errorInterno();
  }
  if (existente.data?.length) return yaExistia(existente.data[0]);

  const { data: id, error } = await supabase.rpc("guardar_comprobante_compra", parametros);
  if (error) {
    // Otro pedido lo cargó entre la búsqueda y el alta: lo frena el índice único.
    if (error.code === "23505" && error.message.includes('"comprobante_compra_numero_unico"')) {
      const otro = await buscarExistente(supabase, parametros.p_comprobante);
      if (!otro.error && otro.data?.length) return yaExistia(otro.data[0]);
    }
    if (esErrorDeDatos(error.code)) {
      return errorApi(422, CODIGOS_ERROR.VALIDACION, mensajeErrorComprobanteCompra(error));
    }
    console.error("[api] No se pudo guardar el comprobante de compra", error);
    return errorInterno();
  }

  return respuestaJson({ id, estado: "borrador", creado: true }, 201);
}
