/**
 * API de proveedores para integraciones (Factura Digital). Ver el contrato
 * en odd/tasks/api-compras.md.
 *
 *   GET  /api/v1/proveedores?cuit=<11 dígitos>  → 200 { proveedores: [...] } (vacía si no existe)
 *   POST /api/v1/proveedores                    → 201 { proveedor } | 409 PROVEEDOR_EXISTE { proveedor }
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { autenticar } from "@/lib/api/autenticar";
import {
  COLUMNAS_PROVEEDOR_API,
  validarCuitConsulta,
  validarProveedorNuevo,
  type ProveedorApi,
} from "@/lib/api/proveedores";
import { CODIGOS_ERROR, errorApi, errorInterno, leerJson, respuestaJson } from "@/lib/api/respuestas";
import { mensajeErrorProveedor } from "@/lib/proveedores/errores";

const MENSAJE_EXISTE = "Ya existe un proveedor con ese CUIT.";

async function buscarPorCuit(supabase: SupabaseClient, cuit: string) {
  return supabase.from("proveedor").select(COLUMNAS_PROVEEDOR_API).eq("cuit", cuit).returns<ProveedorApi[]>();
}

export async function GET(request: Request): Promise<Response> {
  const auth = await autenticar(request);
  if (!auth.ok) return auth.respuesta;

  const consulta = validarCuitConsulta(new URL(request.url).searchParams.get("cuit"));
  if ("error" in consulta) return errorApi(422, CODIGOS_ERROR.VALIDACION, consulta.error);

  const { data, error } = await buscarPorCuit(auth.supabase, consulta.cuit);
  if (error) {
    console.error("[api] No se pudo buscar el proveedor", error);
    return errorInterno();
  }
  return respuestaJson({ proveedores: data ?? [] });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await autenticar(request);
  if (!auth.ok) return auth.respuesta;

  const cuerpo = await leerJson(request);
  if ("respuesta" in cuerpo) return cuerpo.respuesta;

  const validado = validarProveedorNuevo(cuerpo.datos);
  if ("errores" in validado) return errorApi(422, CODIGOS_ERROR.VALIDACION, validado.errores.join(" "));
  const nuevo = validado.datos;

  const existente = await buscarPorCuit(auth.supabase, nuevo.cuit);
  if (existente.error) {
    console.error("[api] No se pudo buscar el proveedor", existente.error);
    return errorInterno();
  }
  if (existente.data?.length) {
    return errorApi(409, CODIGOS_ERROR.PROVEEDOR_EXISTE, MENSAJE_EXISTE, { proveedor: existente.data[0] });
  }

  const { data, error } = await auth.supabase
    .from("proveedor")
    .insert(nuevo)
    .select(COLUMNAS_PROVEEDOR_API)
    .returns<ProveedorApi[]>()
    .single();

  if (error) {
    // Otro pedido lo creó entre la búsqueda y el alta: el índice único lo frena.
    if (error.code === "23505" && error.message.includes('"proveedor_cuit_uq"')) {
      const otro = await buscarPorCuit(auth.supabase, nuevo.cuit);
      if (!otro.error && otro.data?.length) {
        return errorApi(409, CODIGOS_ERROR.PROVEEDOR_EXISTE, MENSAJE_EXISTE, { proveedor: otro.data[0] });
      }
    }
    // Nombre repetido (con otro CUIT) u otro control de la tabla.
    if (error.code === "23505" || error.code === "23514") {
      return errorApi(422, CODIGOS_ERROR.VALIDACION, mensajeErrorProveedor("crear", error));
    }
    console.error("[api] No se pudo crear el proveedor", error);
    return errorInterno();
  }

  return respuestaJson({ proveedor: data }, 201);
}
