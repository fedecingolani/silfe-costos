import { createClient } from "@/lib/supabase/server";
import { Encabezado, Pastilla, Tarjeta } from "@/components/ui";
import { fechaHora } from "@/lib/formato";
import { MENSAJE_SIN_SECRETO, leerClaveCifrado } from "@/lib/arca/secreto";
import { estadoVencimiento } from "@/lib/arca/vencimiento";
import {
  AMBIENTES_ARCA,
  NOMBRES_AMBIENTE_ARCA,
  type AmbienteArca,
  type ArcaCredencialVisible,
  type ArcaEmisor,
  type PuntoVenta,
} from "@/lib/tipos";
import {
  agregarPuntoVenta,
  borrarPuntoVenta,
  cambiarActivoPuntoVenta,
  guardarCredencial,
  guardarEmisor,
  probarConexion,
} from "./acciones";
import { FormularioCredencial } from "./FormularioCredencial";
import { FormularioEmisor } from "./FormularioEmisor";
import { PruebaConexion } from "./PruebaConexion";
import { PuntosVenta } from "./PuntosVenta";

export const dynamic = "force-dynamic";

// Columnas explícitas: la clave privada cifrada y el ticket nunca se leen acá.
const COLUMNAS_EMISOR =
  "cuit, razon_social, condicion_iva, ambiente, domicilio_comercial, ingresos_brutos, inicio_actividades";
const COLUMNAS_CREDENCIAL =
  "ambiente, certificado_titular, certificado_cuit, certificado_vence, ta_expira, actualizado_en";

function Vencimiento({ vence, ahora }: { vence: string; ahora: Date }) {
  const estado = estadoVencimiento(vence, ahora);
  if (estado === "vencido") return <Pastilla tono="rojo">Vencido el {fechaHora(vence)}</Pastilla>;
  if (estado === "por-vencer") return <Pastilla tono="ambar">Vence el {fechaHora(vence)}</Pastilla>;
  return <span>{fechaHora(vence)}</span>;
}

function Credencial({
  ambiente,
  credencial,
  cuitEmisor,
  ahora,
}: {
  ambiente: AmbienteArca;
  credencial: ArcaCredencialVisible | undefined;
  cuitEmisor: string | null;
  ahora: Date;
}) {
  const ticketVigente = credencial?.ta_expira && new Date(credencial.ta_expira) > ahora;
  return (
    <Tarjeta
      titulo={`Credenciales de ${NOMBRES_AMBIENTE_ARCA[ambiente].toLowerCase()}`}
      acciones={
        credencial ? <Pastilla tono="verde">Clave cargada</Pastilla> : <Pastilla>Sin cargar</Pastilla>
      }
    >
      {credencial && (
        <dl className="space-y-1.5 p-4 text-sm text-stone-700">
          <div className="flex gap-2">
            <dt className="w-24 text-stone-500">Titular</dt>
            <dd>{credencial.certificado_titular ?? "—"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 text-stone-500">CUIT</dt>
            <dd className="tabular-nums">{credencial.certificado_cuit}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 text-stone-500">Vence</dt>
            <dd>
              <Vencimiento vence={credencial.certificado_vence} ahora={ahora} />
            </dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-24 text-stone-500">Ticket</dt>
            <dd>{ticketVigente ? `vigente hasta ${fechaHora(credencial.ta_expira)}` : "sin ticket vigente"}</dd>
          </div>
          {cuitEmisor && credencial.certificado_cuit !== cuitEmisor && (
            <p className="pt-1 text-xs text-red-700">
              El certificado es de otra CUIT que la del emisor ({cuitEmisor}). Subí el que corresponde.
            </p>
          )}
        </dl>
      )}
      <FormularioCredencial accion={guardarCredencial.bind(null, ambiente)} reemplaza={Boolean(credencial)} />
    </Tarjeta>
  );
}

export default async function ArcaPage() {
  const supabase = await createClient();
  const [
    { data: emisorData, error: errorEmisor },
    { data: credencialesData, error: errorCredenciales },
    { data: puntosData, error: errorPuntos },
  ] = await Promise.all([
    supabase.from("arca_emisor").select(COLUMNAS_EMISOR).eq("id", true).maybeSingle(),
    supabase.from("arca_credencial").select(COLUMNAS_CREDENCIAL),
    supabase.from("punto_venta").select("numero, nombre, electronico, activo").order("numero"),
  ]);

  const errorCarga = errorEmisor ?? errorCredenciales ?? errorPuntos;
  if (errorCarga) {
    return <p className="text-sm text-red-700">Error al cargar la configuración de ARCA: {errorCarga.message}</p>;
  }

  const emisor = emisorData as Omit<ArcaEmisor, "id" | "actualizado_en"> | null;
  const credenciales = (credencialesData ?? []) as ArcaCredencialVisible[];
  const sinSecreto = leerClaveCifrado() === null;
  const ahora = new Date();
  const ambienteActivo = emisor?.ambiente ?? "homologacion";
  const puntos = (puntosData ?? []) as Pick<PuntoVenta, "numero" | "nombre" | "electronico" | "activo">[];
  const electronicosActivos = puntos.filter((p) => p.electronico && p.activo).map((p) => Number(p.numero));

  return (
    <>
      <Encabezado
        titulo="ARCA"
        descripcion="Datos del emisor y credenciales para la factura electrónica. El certificado y la clave privada se cargan por ambiente; la clave se guarda cifrada y nunca vuelve al navegador."
      />

      {sinSecreto && (
        <div
          role="alert"
          className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {MENSAJE_SIN_SECRETO}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[26rem_1fr] lg:items-start">
        <div className="space-y-6">
          <Tarjeta titulo="Emisor">
            <FormularioEmisor accion={guardarEmisor} emisor={emisor} />
          </Tarjeta>
          <Tarjeta
            titulo="Probar conexión"
            descripcion={`Con el ambiente activo: ${NOMBRES_AMBIENTE_ARCA[ambienteActivo].toLowerCase()}.`}
          >
            <PruebaConexion accion={probarConexion} deshabilitado={sinSecreto} puntosVenta={electronicosActivos} />
          </Tarjeta>
        </div>

        <div className="space-y-6">
          <Tarjeta
            titulo="Puntos de venta"
            descripcion="Los activos se ofrecen al cargar un comprobante. Los electrónicos autorizan en ARCA."
          >
            <PuntosVenta
              puntos={puntos}
              agregar={agregarPuntoVenta}
              cambiarActivo={cambiarActivoPuntoVenta}
              borrar={borrarPuntoVenta}
            />
          </Tarjeta>

          {AMBIENTES_ARCA.map((ambiente) => (
            <Credencial
              key={ambiente}
              ambiente={ambiente}
              credencial={credenciales.find((c) => c.ambiente === ambiente)}
              cuitEmisor={emisor?.cuit ?? null}
              ahora={ahora}
            />
          ))}

          <Tarjeta titulo="Cómo se consiguen las credenciales">
            <div className="space-y-2 p-4 text-sm text-stone-600">
              <p>
                1. Generá una clave privada y un pedido de certificado (CSR) con OpenSSL. Guardá el archivo .key:
                es lo que se sube acá junto con el certificado.
              </p>
              <p>
                2. En ARCA, con clave fiscal, pedí el certificado: &quot;WSASS – Autogestión Certificados
                Homologación&quot; para pruebas o &quot;Administración de Certificados Digitales&quot; para
                producción. Descargá el .crt.
              </p>
              <p>
                3. Asociá el certificado al servicio de factura electrónica (wsfe) y habilitá un punto de venta
                para Web Services.
              </p>
              <p className="text-xs text-stone-500">
                El ticket de acceso de ARCA dura 12 horas y se reutiliza mientras esté vigente. Al reemplazar las
                credenciales se descarta el ticket guardado.
              </p>
            </div>
          </Tarjeta>
        </div>
      </div>
    </>
  );
}
