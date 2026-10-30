"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MENSAJE_SIN_SECRETO, leerClaveCifrado } from "@/lib/arca/secreto";
import type { FetchArca } from "@/lib/arca/wsaa";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { filtroBusquedaClientes } from "@/lib/clientes/busqueda";
import { asociadosParaGuardar, leerAsociados } from "@/lib/comprobantes/asociados-carga";
import { autorizar, type ServiciosArca } from "@/lib/comprobantes/autorizar";
import { repositorioComprobantes, serviciosArca } from "@/lib/comprobantes/autorizar-supabase";
import {
  armarBorrador,
  mensajeErrorGuardado,
  type ItemGuardado,
  type ProductoCatalogo,
} from "@/lib/comprobantes/borrador";
import { nombreComprobante } from "@/lib/comprobantes/listado";
import { armarNota } from "@/lib/comprobantes/notas";
import { pesos } from "@/lib/formato";
import {
  CLASES_COMPROBANTE,
  NOMBRES_AMBIENTE_ARCA,
  type AmbienteArca,
  type ClaseComprobante,
  type CondicionIva,
  type EstadoComprobante,
} from "@/lib/tipos";

// Next enmascara en producción los errores lanzados desde una acción: las
// acciones devuelven el mensaje en lugar de lanzarlo. Ninguna devuelve la
// clave privada, el token ni el sign, ni lee nada de arca_credencial salvo
// autorizar (en el servidor, ver autorizar-supabase.ts).

export type EstadoAccionComprobante = { error?: string; ok?: string; estado?: EstadoComprobante };

export type ResultadoGuardado = {
  error?: string;
  ok?: string;
  id?: string;
  /** Resumen para confirmar la autorización: qué se emite, a quién, por cuánto y dónde. */
  resumen?: string;
};

export type ClienteEncontrado = {
  id: string;
  razon_social: string;
  cuit: string | null;
  condicion_iva: CondicionIva | null;
  codigo_legado: number | null;
};

const RUTA = "/comprobantes";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fetchArca: FetchArca = (url, init) => fetch(url, init);

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Productos del catálogo con la unidad de venta (o la de costeo) ya resuelta. */
async function productosPorId(supabase: Supabase, ids: string[]): Promise<Map<string, ProductoCatalogo> | string> {
  const mapa = new Map<string, ProductoCatalogo>();
  if (ids.length === 0) return mapa;
  const [{ data: productos, error }, { data: unidades, error: errorUnidades }] = await Promise.all([
    supabase.from("producto").select("id, codigo, nombre, alicuota_iva, unidad_id, unidad_venta_id").in("id", ids),
    supabase.from("unidad_medida").select("id, nombre"),
  ]);
  if (error || errorUnidades) return `No se pudieron leer los productos: ${(error ?? errorUnidades)!.message}`;
  const nombreUnidad = new Map((unidades ?? []).map((u) => [u.id as string, u.nombre as string]));
  for (const p of productos ?? []) {
    const unidadId = p.unidad_venta_id ?? p.unidad_id;
    mapa.set(p.id, {
      id: p.id,
      codigo: p.codigo,
      nombre: p.nombre,
      alicuota_iva: Number(p.alicuota_iva),
      unidad: unidadId ? (nombreUnidad.get(unidadId) ?? null) : null,
    });
  }
  return mapa;
}

/**
 * Crea (id null) o actualiza un borrador con su cabecera e ítems en una sola
 * transacción (guardar_borrador_comprobante). Un rechazado vuelve a borrador.
 * `datos` es el JSON de BorradorEnviado: importes y totales se recalculan acá.
 * Una nota generada desde otro comprobante conserva ese asociado y su letra;
 * una cargada a mano guarda el asociado de la pantalla con la CUIT del emisor.
 */
export async function guardarBorrador(id: string | null, datos: string): Promise<ResultadoGuardado> {
  if (id !== null && !UUID.test(id)) return { error: "Comprobante inválido." };
  let enviado: unknown;
  try {
    enviado = JSON.parse(datos);
  } catch {
    return { error: "Los datos del comprobante no son válidos." };
  }

  const supabase = await createClient();
  const clienteId =
    typeof enviado === "object" && enviado !== null ? (enviado as { clienteId?: unknown }).clienteId : null;
  let cliente: { razon_social: string; condicion_iva: CondicionIva | null } | null = null;
  if (typeof clienteId === "string" && UUID.test(clienteId)) {
    const { data, error } = await supabase
      .from("cliente")
      .select("razon_social, condicion_iva")
      .eq("id", clienteId)
      .maybeSingle();
    if (error) return { error: `No se pudo leer el cliente: ${error.message}` };
    cliente = data;
  }

  const items = (enviado as { items?: unknown })?.items;
  const ids = Array.isArray(items)
    ? [...new Set(items.map((i) => (i as { productoId?: unknown })?.productoId).filter((v): v is string => typeof v === "string" && UUID.test(v)))]
    : [];
  const productos = await productosPorId(supabase, ids);
  if (typeof productos === "string") return { error: productos };

  // Si el punto de venta es electrónico se lee de la base: no se confía en la pantalla.
  const puntoVentaEnviado = Number((enviado as { puntoVenta?: unknown })?.puntoVenta);
  let puntoVentaElectronico: boolean | null = null;
  if (Number.isInteger(puntoVentaEnviado) && puntoVentaEnviado > 0) {
    const { data: puntoVenta, error: errorPuntoVenta } = await supabase
      .from("punto_venta")
      .select("electronico")
      .eq("numero", puntoVentaEnviado)
      .maybeSingle();
    if (errorPuntoVenta) return { error: `No se pudo leer el punto de venta: ${errorPuntoVenta.message}` };
    puntoVentaElectronico = puntoVenta ? Boolean(puntoVenta.electronico) : null;
  }

  // Asociado de la base (un X no tiene tipo de ARCA: tipoArca null).
  let asociadoInterno: { tipoArca: number | null } | null = null;
  if (id !== null) {
    const asociados = await leerAsociados(supabase, id);
    if (typeof asociados === "string") return { error: asociados };
    const interno = asociados.find((a) => a.interno)?.interno;
    if (interno) asociadoInterno = { tipoArca: interno.tipo_arca };
  }
  const { data: emisor, error: errorEmisor } = await supabase.from("arca_emisor").select("cuit").eq("id", true).maybeSingle();
  if (errorEmisor) return { error: `No se pudieron leer los datos del emisor: ${errorEmisor.message}` };

  const armado = armarBorrador(enviado, {
    productos,
    condicionIvaCliente: cliente?.condicion_iva ?? null,
    puntoVentaElectronico,
    asociadoInterno,
    cuitEmisor: (emisor?.cuit as string | null | undefined) ?? null,
  });
  if ("errores" in armado) return { error: armado.errores.join(" ") };
  if (!cliente) return { error: "El cliente ya no existe." };

  const { data: guardadoId, error } = await supabase.rpc("guardar_borrador_comprobante", {
    p_id: id,
    p_comprobante: armado.borrador.cabecera,
    p_items: armado.borrador.items,
    // null: la nota conserva el asociado de la base que ya tiene.
    p_asociados: armado.borrador.asociados,
  });
  if (error) return { error: mensajeErrorGuardado(error) };
  const nuevoId = String(guardadoId);

  const { data: guardado } = await supabase.from("comprobante").select("ambiente").eq("id", nuevoId).maybeSingle();
  const ambiente = (guardado?.ambiente ?? null) as AmbienteArca | null;
  const { cabecera } = armado.borrador;
  const resumen =
    `Se va a emitir ${nombreComprobante(cabecera.clase, cabecera.letra)} a ${cliente.razon_social} ` +
    `por ${pesos(cabecera.total)}` +
    (ambiente ? ` en ${NOMBRES_AMBIENTE_ARCA[ambiente].toLowerCase()}` : "") +
    ". No se puede deshacer.";

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${nuevoId}`);
  return { ok: "Borrador guardado.", id: nuevoId, resumen };
}

/** Borra un borrador o un rechazado (los ítems se van en cascada) y vuelve al listado. */
export async function borrarBorrador(id: string): Promise<EstadoAccionComprobante> {
  if (!UUID.test(id)) return { error: "Comprobante inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("comprobante")
    .delete()
    .eq("id", id)
    .in("estado", ["borrador", "rechazado"])
    .select("id");
  if (error) return { error: mensajeErrorGuardado(error) };
  if ((data ?? []).length !== 1) return { error: "Sólo se pueden borrar borradores y rechazados." };
  revalidatePath(RUTA);
  redirect(RUTA);
}

/**
 * Crea un borrador nuevo con el mismo cliente, la misma cabecera, los mismos
 * ítems y los mismos comprobantes (o período) asociados, con fecha de hoy. Sirve para
 * cualquier estado. Si el punto de venta se desactivó, usa el electrónico
 * activo de número más bajo.
 */
export async function duplicarComprobante(id: string): Promise<EstadoAccionComprobante> {
  if (!UUID.test(id)) return { error: "Comprobante inválido." };
  const supabase = await createClient();
  const [{ data: c, error }, { data: items, error: errorItems }, { data: puntos, error: errorPuntos }] =
    await Promise.all([
      supabase
        .from("comprobante")
        .select(
          "punto_venta, clase, letra, tipo_arca, cliente_id, lista_precio_id, condicion_pago, observaciones, periodo_asoc_desde, periodo_asoc_hasta, neto, no_gravado, iva, total",
        )
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("comprobante_item")
        .select(
          "producto_id, codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct, gravado, alicuota_iva, importe, iva",
        )
        .eq("comprobante_id", id)
        .order("orden"),
      supabase.from("punto_venta").select("numero").eq("activo", true).eq("electronico", true).order("numero"),
    ]);
  const errorCarga = error ?? errorItems ?? errorPuntos;
  if (errorCarga) return { error: `No se pudo leer el comprobante: ${errorCarga.message}` };
  if (!c) return { error: "No se encontró el comprobante." };

  const activos = (puntos ?? []).map((p) => Number(p.numero));
  const puntoVenta = activos.includes(Number(c.punto_venta)) ? Number(c.punto_venta) : activos[0];
  if (puntoVenta === undefined) return { error: "No hay ningún punto de venta electrónico activo." };
  const asociados = await leerAsociados(supabase, id);
  if (typeof asociados === "string") return { error: asociados };

  const hoy = hoyArgentina();
  const { data: nuevoId, error: errorGuardar } = await supabase.rpc("guardar_borrador_comprobante", {
    p_id: null,
    p_comprobante: {
      punto_venta: puntoVenta,
      clase: c.clase,
      letra: c.letra,
      tipo_arca: c.tipo_arca,
      fecha: hoy,
      fecha_vencimiento_pago: hoy,
      cliente_id: c.cliente_id,
      lista_precio_id: c.lista_precio_id,
      condicion_pago: c.condicion_pago,
      observaciones: c.observaciones,
      periodo_asoc_desde: c.periodo_asoc_desde,
      periodo_asoc_hasta: c.periodo_asoc_hasta,
      neto: c.neto,
      no_gravado: c.no_gravado,
      iva: c.iva,
      total: c.total,
    },
    p_items: (items ?? []) as ItemGuardado[],
    p_asociados: asociadosParaGuardar(asociados),
  });
  if (errorGuardar) return { error: mensajeErrorGuardado(errorGuardar) };

  revalidatePath(RUTA);
  redirect(`${RUTA}/${String(nuevoId)}`);
}

/**
 * Genera una nota de crédito o débito desde un comprobante autorizado: un
 * borrador con el mismo cliente, punto de venta, lista y condición de pago,
 * fecha de hoy, los ítems copiados y el comprobante como asociado. Abre el
 * editor para ajustar cantidades o precios.
 */
export async function generarNota(id: string, clase: ClaseComprobante): Promise<EstadoAccionComprobante> {
  if (!UUID.test(id) || !(CLASES_COMPROBANTE as readonly string[]).includes(clase)) {
    return { error: "Comprobante inválido." };
  }
  const supabase = await createClient();
  const [{ data: c, error }, { data: items, error: errorItems }, { data: puntos, error: errorPuntos }] =
    await Promise.all([
      supabase
        .from("comprobante")
        .select("id, estado, clase, letra, punto_venta, cliente_id, lista_precio_id, condicion_pago")
        .eq("id", id)
        .maybeSingle(),
      supabase
        .from("comprobante_item")
        .select(
          "producto_id, codigo, descripcion, observaciones, unidad, cantidad, precio_unitario, descuento_pct, gravado, alicuota_iva, importe, iva",
        )
        .eq("comprobante_id", id)
        .order("orden"),
      supabase.from("punto_venta").select("numero").eq("activo", true).eq("electronico", true).order("numero"),
    ]);
  const errorCarga = error ?? errorItems ?? errorPuntos;
  if (errorCarga) return { error: `No se pudo leer el comprobante: ${errorCarga.message}` };
  if (!c) return { error: "No se encontró el comprobante." };

  const nota = armarNota(
    { ...c, punto_venta: Number(c.punto_venta) },
    ((items ?? []) as ItemGuardado[]).map((i) => ({
      ...i,
      cantidad: Number(i.cantidad),
      precio_unitario: Number(i.precio_unitario),
      descuento_pct: Number(i.descuento_pct),
      importe: Number(i.importe),
      iva: Number(i.iva),
    })),
    clase,
    hoyArgentina(),
    (puntos ?? []).map((p) => Number(p.numero)),
  );
  if ("error" in nota) return { error: nota.error };

  const { data: nuevoId, error: errorGuardar } = await supabase.rpc("guardar_borrador_comprobante", {
    p_id: null,
    p_comprobante: nota.cabecera,
    p_items: nota.items,
    p_asociados: nota.asociados,
  });
  if (errorGuardar) return { error: mensajeErrorGuardado(errorGuardar) };

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  redirect(`${RUTA}/${String(nuevoId)}`);
}

/** Clientes activos para el buscador del comprobante (misma búsqueda que el listado de clientes). */
export async function buscarClientes(texto: string): Promise<ClienteEncontrado[]> {
  const filtro = filtroBusquedaClientes(texto);
  if (!filtro) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("cliente")
    .select("id, razon_social, cuit, condicion_iva, codigo_legado")
    .eq("activo", true)
    .or(filtro)
    .order("razon_social")
    .limit(15);
  if (error) {
    console.error("buscarClientes:", error.message);
    return [];
  }
  return (data ?? []) as ClienteEncontrado[];
}

/** Precios finales (sin IVA) de una lista: [producto_id, precio_final] en el orden de la lista. */
export async function preciosDeLista(listaId: string): Promise<{ producto_id: string | null; precio_final: number }[]> {
  if (!UUID.test(listaId)) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lista_precio_item")
    .select("producto_id, precio_final")
    .eq("lista_id", listaId)
    .order("orden");
  if (error) return [];
  return (data ?? []).map((f) => ({ producto_id: f.producto_id, precio_final: Number(f.precio_final) }));
}

/** ARCA sin el secreto de cifrado: sólo sirve para un comprobante X, que no lo usa. */
const SIN_ARCA: ServiciosArca = {
  autenticar: async () => {
    throw new Error(MENSAJE_SIN_SECRETO);
  },
  ultimoAutorizado: async () => {
    throw new Error(MENSAJE_SIN_SECRETO);
  },
  solicitarCae: async () => {
    throw new Error(MENSAJE_SIN_SECRETO);
  },
  consultar: async () => {
    throw new Error(MENSAJE_SIN_SECRETO);
  },
};

/** true si el punto de venta del comprobante no es electrónico (comprobante X). */
async function esNoElectronico(supabase: Supabase, id: string): Promise<boolean> {
  const { data: c } = await supabase.from("comprobante").select("punto_venta").eq("id", id).maybeSingle();
  if (!c) return false;
  const { data: puntoVenta } = await supabase
    .from("punto_venta")
    .select("electronico")
    .eq("numero", c.punto_venta)
    .maybeSingle();
  return puntoVenta?.electronico === false;
}

/**
 * Autoriza el comprobante en ARCA (CAE). Si quedó en verificación por una
 * respuesta perdida, primero lo reconcilia con ARCA. Un X (punto de venta no
 * electrónico) se emite sin ARCA: no necesita el secreto ni las credenciales.
 */
export async function autorizarComprobante(id: string): Promise<EstadoAccionComprobante> {
  if (!UUID.test(id)) return { error: "Comprobante inválido." };
  const supabase = await createClient();
  const claveCifrado = leerClaveCifrado();
  if (!claveCifrado && !(await esNoElectronico(supabase, id))) return { error: MENSAJE_SIN_SECRETO };

  const resultado = await autorizar(id, {
    repositorio: repositorioComprobantes(supabase),
    arca: claveCifrado ? serviciosArca(supabase, fetchArca, claveCifrado) : SIN_ARCA,
  });

  revalidatePath(RUTA);
  revalidatePath(`${RUTA}/${id}`);
  return resultado.error
    ? { error: resultado.error, estado: resultado.estado }
    : { ok: resultado.ok, estado: resultado.estado };
}
