"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { aNumero, aTexto } from "@/lib/formato";
import {
  AMBIENTES_ARCA,
  CONDICIONES_IVA_EMISOR,
  NOMBRES_AMBIENTE_ARCA,
  type AmbienteArca,
  type CondicionIvaEmisor,
} from "@/lib/tipos";
import { obtenerTicket } from "@/lib/arca/acceso";
import { almacenTicket } from "@/lib/arca/almacen-ticket";
import { analizarCertificado, validarCredencial } from "@/lib/arca/certificado";
import { cifrar } from "@/lib/arca/cifrado";
import { esCuitValida, normalizarCuit } from "@/lib/arca/cuit";
import { MENSAJE_SIN_SECRETO, leerClaveCifrado } from "@/lib/arca/secreto";
import type { FetchArca } from "@/lib/arca/wsaa";
import {
  feCompUltimoAutorizado,
  feDummy,
  tipoComprobantePorDefecto,
  type EstadoServidores,
} from "@/lib/arca/wsfe";

// Next enmascara en producción los errores lanzados desde una acción: las
// acciones devuelven el mensaje en lugar de lanzarlo. Ninguna devuelve la
// clave privada, el token ni el sign: sólo mensajes y datos para mostrar.

/** Estado de los formularios de emisor y credenciales. */
export type EstadoFormularioArca = { error?: string; ok?: string } | undefined;

export type ResultadoPrueba = {
  ambiente: AmbienteArca;
  servidores?: EstadoServidores;
  ticket?: { origen: "reutilizado" | "nuevo"; expira: string };
  ultimo?: { puntoVenta: number; tipoComprobante: number; numero: number };
};

export type EstadoPruebaConexion = { error?: string; resultado?: ResultadoPrueba } | undefined;

/** Archivos de certificado y clave: unos pocos KB. Más que esto no es un PEM. */
const TAMANO_MAXIMO_ARCHIVO = 20 * 1024;

const RUTA = "/configuracion/arca";

const fetchArca: FetchArca = (url, init) => fetch(url, init);

function mensaje(error: unknown): string {
  if (error instanceof TypeError) return `No se pudo conectar con ARCA: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

// ----- Emisor ------------------------------------------------------------

export async function guardarEmisor(
  _estado: EstadoFormularioArca,
  formData: FormData,
): Promise<EstadoFormularioArca> {
  const cuit = normalizarCuit(String(formData.get("cuit") ?? "").trim());
  if (!esCuitValida(cuit)) {
    return { error: "La CUIT no es válida: tienen que ser 11 números con el dígito verificador correcto." };
  }
  const razonSocial = aTexto(formData.get("razon_social"));
  if (!razonSocial) return { error: "Completá la razón social." };
  const condicionIva = String(formData.get("condicion_iva") ?? "");
  if (!(CONDICIONES_IVA_EMISOR as readonly string[]).includes(condicionIva)) {
    return { error: "Elegí la condición frente al IVA." };
  }
  const puntoVenta = aNumero(formData.get("punto_venta"));
  if (puntoVenta === null || !Number.isInteger(puntoVenta) || puntoVenta < 1 || puntoVenta > 99999) {
    return { error: "El punto de venta tiene que ser un número entero entre 1 y 99999." };
  }
  const ambiente = String(formData.get("ambiente") ?? "");
  if (!(AMBIENTES_ARCA as readonly string[]).includes(ambiente)) {
    return { error: "Elegí el ambiente: homologación o producción." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("arca_emisor")
    .update({
      cuit,
      razon_social: razonSocial,
      condicion_iva: condicionIva,
      punto_venta: puntoVenta,
      ambiente,
    })
    .eq("id", true)
    .select("id");
  if (error) return { error: `No se pudieron guardar los datos del emisor: ${error.message}` };
  // Sin filas actualizadas (fila única ausente o RLS) no hay que informar éxito.
  if ((data ?? []).length !== 1) return { error: "No se pudieron guardar los datos del emisor: no se actualizó ningún registro." };
  revalidatePath(RUTA);
  return { ok: "Datos del emisor guardados." };
}

// ----- Credenciales ------------------------------------------------------

async function leerArchivo(valor: FormDataEntryValue | null, nombre: string): Promise<string | { error: string }> {
  if (!(valor instanceof File) || valor.size === 0) return { error: `Elegí el archivo ${nombre}.` };
  if (valor.size > TAMANO_MAXIMO_ARCHIVO) {
    return { error: `El archivo ${nombre} pesa más de 20 KB: no parece el que corresponde.` };
  }
  return valor.text();
}

export async function guardarCredencial(
  ambiente: AmbienteArca,
  _estado: EstadoFormularioArca,
  formData: FormData,
): Promise<EstadoFormularioArca> {
  if (!AMBIENTES_ARCA.includes(ambiente)) return { error: "Ambiente desconocido." };
  const claveCifrado = leerClaveCifrado();
  if (!claveCifrado) return { error: MENSAJE_SIN_SECRETO };

  const certificadoPem = await leerArchivo(formData.get("certificado"), "del certificado (.crt o .pem)");
  if (typeof certificadoPem !== "string") return certificadoPem;
  const clavePem = await leerArchivo(formData.get("clave"), "de la clave privada (.key)");
  if (typeof clavePem !== "string") return clavePem;

  const supabase = await createClient();
  const { data: emisor, error: errorEmisor } = await supabase
    .from("arca_emisor")
    .select("cuit")
    .eq("id", true)
    .single();
  if (errorEmisor) return { error: `No se pudieron leer los datos del emisor: ${errorEmisor.message}` };
  if (!emisor?.cuit) return { error: "Primero guardá la CUIT del emisor: el certificado tiene que ser de esa CUIT." };

  const errores = validarCredencial({ certificadoPem, clavePem, cuitEmisor: emisor.cuit, ahora: new Date() });
  if (errores.length > 0) return { error: errores.join(" ") };

  const datos = analizarCertificado(certificadoPem);
  let claveCifrada: string;
  try {
    claveCifrada = await cifrar(clavePem, claveCifrado);
  } catch (e) {
    return { error: mensaje(e) };
  }

  // Credencial nueva: el ticket guardado era del certificado anterior.
  const { error } = await supabase.from("arca_credencial").upsert(
    {
      ambiente,
      certificado_pem: certificadoPem,
      certificado_titular: datos.titular,
      certificado_cuit: datos.cuit,
      certificado_vence: datos.vence.toISOString(),
      clave_cifrada: claveCifrada,
      ta_cifrado: null,
      ta_expira: null,
      ta_bloqueado_hasta: null,
    },
    { onConflict: "ambiente" },
  );
  if (error) return { error: `No se pudieron guardar las credenciales: ${error.message}` };
  revalidatePath(RUTA);
  return { ok: `Credenciales de ${NOMBRES_AMBIENTE_ARCA[ambiente].toLowerCase()} guardadas.` };
}

// ----- Probar conexión ---------------------------------------------------

/** Acción de useActionState: no usa el estado anterior ni datos del formulario. */
export async function probarConexion(): Promise<EstadoPruebaConexion> {
  const claveCifrado = leerClaveCifrado();
  if (!claveCifrado) return { error: MENSAJE_SIN_SECRETO };

  const supabase = await createClient();
  const { data: emisor, error: errorEmisor } = await supabase
    .from("arca_emisor")
    .select("cuit, condicion_iva, punto_venta, ambiente")
    .eq("id", true)
    .single();
  if (errorEmisor || !emisor) {
    return { error: `No se pudieron leer los datos del emisor: ${errorEmisor?.message ?? "sin datos"}` };
  }
  if (!emisor.cuit || !emisor.condicion_iva || !emisor.punto_venta) {
    return { error: "Completá y guardá los datos del emisor (CUIT, condición frente al IVA y punto de venta)." };
  }
  const ambiente = emisor.ambiente as AmbienteArca;

  // La clave cifrada se lee sólo acá, en el servidor, y no sale de esta función.
  const { data: credencial, error: errorCredencial } = await supabase
    .from("arca_credencial")
    .select("certificado_pem, clave_cifrada")
    .eq("ambiente", ambiente)
    .maybeSingle();
  if (errorCredencial) return { error: `No se pudieron leer las credenciales: ${errorCredencial.message}` };
  if (!credencial) {
    return { error: `Cargá el certificado y la clave de ${NOMBRES_AMBIENTE_ARCA[ambiente].toLowerCase()}.` };
  }

  const resultado: ResultadoPrueba = { ambiente };
  try {
    resultado.servidores = await feDummy(fetchArca, ambiente);

    const ticket = await obtenerTicket({
      almacen: almacenTicket(supabase, ambiente),
      fetchArca,
      ambiente,
      claveCifrado,
      certificadoPem: credencial.certificado_pem,
      claveCifrada: credencial.clave_cifrada,
    });
    resultado.ticket = { origen: ticket.origen, expira: ticket.expira.toISOString() };

    const tipoComprobante = tipoComprobantePorDefecto(emisor.condicion_iva as CondicionIvaEmisor);
    const numero = await feCompUltimoAutorizado(
      fetchArca,
      ambiente,
      { token: ticket.token, sign: ticket.sign, cuit: emisor.cuit },
      emisor.punto_venta,
      tipoComprobante,
    );
    resultado.ultimo = { puntoVenta: emisor.punto_venta, tipoComprobante, numero };
    return { resultado };
  } catch (e) {
    return { resultado, error: mensaje(e) };
  } finally {
    revalidatePath(RUTA);
  }
}
