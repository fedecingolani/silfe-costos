/**
 * Dependencias reales de autorizar(): el comprobante en Supabase y ARCA por
 * HTTP. Sólo para el servidor: lee la clave cifrada de la credencial y la
 * pasa a obtenerTicket, que es el único que la descifra.
 *
 * Cada cambio de estado es un update condicional al estado esperado: si
 * otro pedido lo cambió en el medio, no se pisa y se informa.
 */
import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { obtenerTicket } from "@/lib/arca/acceso";
import { almacenTicket } from "@/lib/arca/almacen-ticket";
import type { FetchArca } from "@/lib/arca/wsaa";
import {
  feCAESolicitar,
  feCompConsultar,
  feCompUltimoAutorizado,
  type AsociadoSolicitud,
} from "@/lib/arca/wsfe";
import type { AmbienteArca, EstadoComprobante } from "@/lib/tipos";
import {
  ErrorBaseDatos,
  type DatosAutorizacion,
  type RepositorioComprobantes,
  type ServiciosArca,
} from "./autorizar";
import { asociadoManual } from "./asociados";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type ErrorPostgrest = { code?: string; message: string } | null;

function fallar(contexto: string, error: NonNullable<ErrorPostgrest>): never {
  throw new ErrorBaseDatos(error.code, `${contexto}: ${error.message}`);
}

const SIN_CAMBIOS =
  "El comprobante cambió de estado mientras se autorizaba. Recargá la página y volvé a intentar.";

const numero = (valor: unknown) => (valor === null || valor === undefined ? null : Number(valor));

export function repositorioComprobantes(supabase: Supabase): RepositorioComprobantes {
  /** Update del comprobante sólo si está en alguno de `estados`; exige una fila. */
  async function actualizar(id: string, estados: EstadoComprobante[], cambios: Record<string, unknown>) {
    const { data, error } = await supabase
      .from("comprobante")
      .update(cambios)
      .eq("id", id)
      .in("estado", estados)
      .select("id");
    if (error) fallar("No se pudo actualizar el comprobante", error);
    if ((data ?? []).length !== 1) throw new ErrorBaseDatos("CM002", SIN_CAMBIOS);
  }

  async function asociados(id: string, cuitEmisor: string | null): Promise<AsociadoSolicitud[]> {
    const { data, error } = await supabase
      .from("comprobante_asociado")
      .select("asociado_id, tipo_arca, punto_venta, numero, fecha, cuit")
      .eq("comprobante_id", id);
    if (error) fallar("No se pudieron leer los comprobantes asociados", error);
    const filas = data ?? [];

    const ids = filas.map((f) => f.asociado_id).filter((v): v is string => Boolean(v));
    const enBase = new Map<string, { tipo_arca: number | null; punto_venta: number; numero: number | null; fecha: string; estado: string }>();
    if (ids.length > 0) {
      const { data: comprobantes, error: errorBase } = await supabase
        .from("comprobante")
        .select("id, tipo_arca, punto_venta, numero, fecha, estado")
        .in("id", ids);
      if (errorBase) fallar("No se pudieron leer los comprobantes asociados", errorBase);
      for (const f of comprobantes ?? []) enBase.set(f.id, f);
    }

    return filas.map((f) => {
      // Se valida antes de tocar ARCA: el error llega tal cual a la pantalla.
      if (!f.asociado_id) return asociadoManual(f);
      const asociado = enBase.get(f.asociado_id);
      if (!asociado || asociado.estado !== "autorizado" || asociado.numero === null || asociado.tipo_arca === null) {
        throw new Error("El comprobante asociado no está autorizado: sólo se asocian comprobantes con número.");
      }
      return {
        tipo: Number(asociado.tipo_arca),
        puntoVenta: Number(asociado.punto_venta),
        numero: Number(asociado.numero),
        fecha: asociado.fecha,
        cuit: cuitEmisor ?? undefined,
      };
    });
  }

  return {
    async cargar(id) {
      const { data: c, error } = await supabase
        .from("comprobante")
        .select(
          "id, estado, punto_venta, ambiente, clase, letra, tipo_arca, fecha, total, receptor_doc_nro, intento_numero, cliente_id",
        )
        .eq("id", id)
        .maybeSingle();
      if (error) fallar("No se pudo leer el comprobante", error);
      if (!c) return null;

      const [items, cliente, puntoVenta, emisor] = await Promise.all([
        supabase
          .from("comprobante_item")
          .select("id, cantidad, precio_unitario, descuento_pct, alicuota_iva, importe, iva")
          .eq("comprobante_id", id)
          .order("orden"),
        supabase
          .from("cliente")
          .select("razon_social, cuit, condicion_iva, direccion, localidad, provincia")
          .eq("id", c.cliente_id)
          .single(),
        supabase.from("punto_venta").select("electronico").eq("numero", c.punto_venta).single(),
        supabase.from("arca_emisor").select("cuit").eq("id", true).maybeSingle(),
      ]);
      if (items.error) fallar("No se pudieron leer los ítems", items.error);
      if (cliente.error) fallar("No se pudo leer el cliente", cliente.error);
      if (puntoVenta.error) fallar("No se pudo leer el punto de venta", puntoVenta.error);
      if (emisor.error) fallar("No se pudieron leer los datos del emisor", emisor.error);

      let credencial: DatosAutorizacion["credencial"] = null;
      if (c.ambiente) {
        // La clave cifrada se lee sólo acá y sólo llega a obtenerTicket.
        const { data, error: errorCredencial } = await supabase
          .from("arca_credencial")
          .select("certificado_pem, clave_cifrada")
          .eq("ambiente", c.ambiente)
          .maybeSingle();
        if (errorCredencial) fallar("No se pudieron leer las credenciales de ARCA", errorCredencial);
        if (data) credencial = { certificadoPem: data.certificado_pem, claveCifrada: data.clave_cifrada };
      }

      const cuitEmisor: string | null = emisor.data?.cuit ?? null;
      return {
        comprobante: {
          id: c.id,
          estado: c.estado,
          puntoVenta: Number(c.punto_venta),
          ambiente: c.ambiente,
          clase: c.clase,
          letra: c.letra,
          tipoArca: numero(c.tipo_arca) as DatosAutorizacion["comprobante"]["tipoArca"],
          fecha: c.fecha,
          total: Number(c.total),
          receptorDocNro: c.receptor_doc_nro,
          intentoNumero: numero(c.intento_numero),
        },
        items: (items.data ?? []).map((i) => ({
          id: i.id,
          cantidad: Number(i.cantidad),
          precioUnitario: Number(i.precio_unitario),
          descuentoPct: Number(i.descuento_pct),
          alicuotaIva: Number(i.alicuota_iva),
          importe: Number(i.importe),
          iva: Number(i.iva),
        })),
        asociados: await asociados(id, cuitEmisor),
        cliente: {
          razonSocial: cliente.data.razon_social,
          cuit: cliente.data.cuit,
          condicionIva: cliente.data.condicion_iva,
          direccion: cliente.data.direccion,
          localidad: cliente.data.localidad,
          provincia: cliente.data.provincia,
        },
        cuitEmisor,
        puntoVentaElectronico: Boolean(puntoVenta.data.electronico),
        credencial,
      };
    },

    async guardarRecalculado(id, d) {
      // Los ítems primero: sólo se pueden cambiar en borrador o rechazado.
      for (const item of d.items) {
        const { error } = await supabase
          .from("comprobante_item")
          .update({ importe: item.importe, iva: item.iva })
          .eq("id", item.id)
          .eq("comprobante_id", id);
        if (error) fallar("No se pudieron actualizar los ítems", error);
      }
      await actualizar(id, ["borrador", "rechazado"], {
        estado: "borrador",
        letra: d.letra,
        tipo_arca: d.tipoArca,
        receptor_razon_social: d.receptor.razonSocial,
        receptor_doc_tipo: d.receptor.docTipo,
        receptor_doc_nro: d.receptor.docNro,
        receptor_condicion_iva: d.receptor.condicionIva,
        receptor_domicilio: d.receptor.domicilio,
        receptor_provincia: d.receptor.provincia,
        neto: d.neto,
        iva: d.iva,
        total: d.total,
      });
    },

    async pasarAVerificando(id, d) {
      await actualizar(id, ["borrador"], {
        estado: "verificando",
        intento_numero: d.intentoNumero,
        letra: d.letra,
        tipo_arca: d.tipoArca,
        // Lo enviado a ARCA: queda fijo desde acá (ver 20261024000005).
        iva_detalle: d.ivaDetalle,
      });
    },

    async cambiarIntento(id, intentoNumero) {
      await actualizar(id, ["verificando"], { intento_numero: intentoNumero });
    },

    async marcarAutorizado(id, d) {
      await actualizar(id, ["verificando"], {
        estado: "autorizado",
        numero: d.numero,
        cae: d.cae,
        cae_vencimiento: d.caeVencimiento,
        arca_resultado: "A",
        arca_observaciones: d.observaciones,
        arca_errores: null,
        autorizado_en: d.autorizadoEn.toISOString(),
      });
    },

    async marcarRechazado(id, d) {
      await actualizar(id, ["verificando"], {
        estado: "rechazado",
        intento_numero: null,
        arca_resultado: d.resultado,
        arca_observaciones: d.observaciones,
        arca_errores: d.errores,
      });
    },

    async volverABorrador(id) {
      await actualizar(id, ["verificando"], { estado: "borrador", intento_numero: null });
    },

    async tomarBloqueo(clave) {
      const { data, error } = await supabase.rpc("tomar_bloqueo_numeracion", {
        p_ambiente: clave.ambiente,
        p_punto_venta: clave.puntoVenta,
        p_tipo_arca: clave.tipoArca,
      });
      if (error) fallar("No se pudo reservar la numeración", error);
      return typeof data === "string" ? data : null;
    },

    async liberarBloqueo(clave, llave) {
      const { error } = await supabase.rpc("liberar_bloqueo_numeracion", {
        p_ambiente: clave.ambiente,
        p_punto_venta: clave.puntoVenta,
        p_tipo_arca: clave.tipoArca,
        p_hasta: llave,
      });
      if (error) fallar("No se pudo liberar la numeración", error);
    },
  };
}

export function serviciosArca(supabase: Supabase, fetchArca: FetchArca, claveCifrado: string): ServiciosArca {
  return {
    async autenticar(ambiente: AmbienteArca, credencial, cuitEmisor) {
      const ticket = await obtenerTicket({
        almacen: almacenTicket(supabase, ambiente),
        fetchArca,
        ambiente,
        claveCifrado,
        certificadoPem: credencial.certificadoPem,
        claveCifrada: credencial.claveCifrada,
      });
      return { token: ticket.token, sign: ticket.sign, cuit: cuitEmisor };
    },
    ultimoAutorizado: (ambiente, auth, puntoVenta, tipo) =>
      feCompUltimoAutorizado(fetchArca, ambiente, auth, puntoVenta, tipo),
    solicitarCae: (ambiente, auth, solicitud) => feCAESolicitar(fetchArca, ambiente, auth, solicitud),
    consultar: (ambiente, auth, puntoVenta, tipo, n) => feCompConsultar(fetchArca, ambiente, auth, puntoVenta, tipo, n),
  };
}
