import Link from "next/link";
import type { ReactNode } from "react";
import { Encabezado, Tarjeta } from "@/components/ui";

function Codigo({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-stone-900 px-3 py-2 text-xs leading-relaxed text-stone-100">
      <code>{children}</code>
    </pre>
  );
}

function Ruta({ children }: { children: ReactNode }) {
  return <span className="font-medium text-stone-800">{children}</span>;
}

function Nota({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{children}</div>
  );
}

function Paso({ numero, titulo, children }: { numero: number; titulo: string; children: ReactNode }) {
  return (
    <Tarjeta titulo={`${numero}. ${titulo}`}>
      <div className="space-y-3 p-4 text-sm text-stone-700">{children}</div>
    </Tarjeta>
  );
}

export default function GuiaCredencialesArcaPage() {
  return (
    <>
      <Encabezado
        titulo="Cómo generar las credenciales de ARCA"
        descripcion="Paso a paso para obtener el certificado y la clave privada que pide la factura electrónica, en homologación (pruebas) y en producción."
        acciones={
          <Link href="/configuracion/arca" className="boton-secundario">
            Volver a ARCA
          </Link>
        }
      />

      <div className="max-w-3xl space-y-6">
        <Tarjeta titulo="Antes de empezar">
          <div className="space-y-2 p-4 text-sm text-stone-700">
            <p>Para conectarse con ARCA hacen falta dos archivos por ambiente:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <Ruta>Clave privada (.key)</Ruta>: la generás vos en tu computadora. Es secreta: no se manda a ARCA ni
                se comparte por mail.
              </li>
              <li>
                <Ruta>Certificado (.crt)</Ruta>: lo emite ARCA a partir de un pedido (CSR) firmado con esa clave.
              </li>
            </ul>
            <p>Vas a necesitar:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>CUIT y clave fiscal nivel 3 o superior de la empresa (o de quien la represente).</li>
              <li>
                OpenSSL instalado. En Mac y Linux ya viene; en Windows se puede usar Git Bash, que lo incluye.
              </li>
            </ul>
            <p>
              Homologación y producción son ambientes separados: cada uno tiene su propio certificado. Podés usar la
              misma clave privada para los dos o generar una por ambiente.
            </p>
          </div>
        </Tarjeta>

        <Paso numero={1} titulo="Generar la clave privada y el pedido de certificado (CSR)">
          <p>Abrí una terminal en una carpeta segura y generá la clave privada:</p>
          <Codigo>openssl genrsa -out silfe.key 2048</Codigo>
          <p>
            Después generá el pedido de certificado. Reemplazá la razón social y la CUIT (sin guiones) por las de la
            empresa; el nombre <code>silfe</code> es libre y sirve para identificar el certificado:
          </p>
          <Codigo>
            {`openssl req -new -key silfe.key \\
  -subj "/C=AR/O=RAZON SOCIAL SA/CN=silfe/serialNumber=CUIT 30123456789" \\
  -out silfe.csr`}
          </Codigo>
          <Nota>
            En Windows con Git Bash, anteponé <code>MSYS_NO_PATHCONV=1</code> al comando. Si no, Git Bash toma el
            texto que empieza con <code>/C=AR</code> como una ruta de archivo, lo cambia y el pedido sale mal.
          </Nota>
          <Codigo>
            {`MSYS_NO_PATHCONV=1 openssl req -new -key silfe.key \\
  -subj "/C=AR/O=RAZON SOCIAL SA/CN=silfe/serialNumber=CUIT 30123456789" \\
  -out silfe.csr`}
          </Codigo>
          <p>
            Quedan dos archivos: <Ruta>silfe.key</Ruta> (guardalo, se sube en esta aplicación) y{" "}
            <Ruta>silfe.csr</Ruta> (es el que se pega en ARCA).
          </p>
          <Nota>
            La CUIT del pedido tiene que ser la misma que la del emisor configurado en ARCA. Si no coinciden, la
            aplicación rechaza el certificado al subirlo.
          </Nota>
        </Paso>

        <Paso numero={2} titulo="Homologación: obtener el certificado de prueba (WSASS)">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Ingresá a ARCA con clave fiscal.</li>
            <li>
              Si no tenés el servicio, adherilo: <Ruta>Administrador de Relaciones de Clave Fiscal</Ruta> →{" "}
              <Ruta>Adherir servicio</Ruta> → <Ruta>ARCA</Ruta> → <Ruta>Servicios interactivos</Ruta> →{" "}
              <Ruta>WSASS – Autogestión Certificados Homologación</Ruta>. Volvé a ingresar para que aparezca.
            </li>
            <li>
              Entrá a <Ruta>WSASS</Ruta> y elegí <Ruta>Nuevo certificado</Ruta>. Poné un nombre simbólico (por ejemplo{" "}
              <code>silfe</code>) y pegá el contenido completo de <Ruta>silfe.csr</Ruta>, incluidas las líneas{" "}
              <code>BEGIN</code> y <code>END</code>.
            </li>
            <li>
              Al confirmar, ARCA muestra el certificado. Copialo completo en un archivo de texto y guardalo como{" "}
              <Ruta>silfe-homologacion.crt</Ruta>.
            </li>
            <li>
              Todavía en WSASS, elegí <Ruta>Crear autorización a servicio</Ruta>: seleccioná el nombre simbólico del
              certificado, la CUIT a representar y el servicio <Ruta>wsfe – Facturación Electrónica</Ruta>. Confirmá.
            </li>
          </ol>
          <Nota>
            En homologación no hace falta dar de alta puntos de venta en ARCA: alcanza con cargarlos como electrónicos
            en esta aplicación.
          </Nota>
        </Paso>

        <Paso numero={3} titulo="Producción: obtener el certificado real">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Si no tenés el servicio, adherí <Ruta>Administración de Certificados Digitales</Ruta> desde el{" "}
              <Ruta>Administrador de Relaciones de Clave Fiscal</Ruta>, igual que en el paso anterior.
            </li>
            <li>
              Entrá a <Ruta>Administración de Certificados Digitales</Ruta>, elegí la CUIT y tocá{" "}
              <Ruta>Agregar alias</Ruta>. Poné un alias (por ejemplo <code>silfe</code>) y subí el archivo{" "}
              <Ruta>silfe.csr</Ruta>.
            </li>
            <li>
              Entrá al alias recién creado y descargá el certificado. Guardalo como <Ruta>silfe-produccion.crt</Ruta>.
            </li>
          </ol>
        </Paso>

        <Paso numero={4} titulo="Producción: autorizar el certificado para factura electrónica">
          <p>El certificado por sí solo no puede facturar: hay que darle permiso sobre el servicio wsfe.</p>
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Entrá a <Ruta>Administrador de Relaciones de Clave Fiscal</Ruta> y elegí <Ruta>Nueva relación</Ruta>.
            </li>
            <li>
              En servicio, tocá <Ruta>Buscar</Ruta> → <Ruta>ARCA</Ruta> → <Ruta>WebServices</Ruta> →{" "}
              <Ruta>Facturación Electrónica</Ruta>.
            </li>
            <li>
              En representante, tocá <Ruta>Buscar</Ruta>, elegí <Ruta>Computador fiscal</Ruta> y seleccioná el alias
              del certificado (<code>silfe</code>).
            </li>
            <li>Confirmá. La relación queda activa en unos minutos.</li>
          </ol>
        </Paso>

        <Paso numero={5} titulo="Producción: habilitar un punto de venta para Web Services">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              Entrá a <Ruta>Administración de puntos de venta y domicilios</Ruta> → <Ruta>A/B/M de puntos de venta</Ruta>.
            </li>
            <li>
              Tocá <Ruta>Agregar</Ruta>, elegí un número libre y en sistema de facturación seleccioná{" "}
              <Ruta>RECE para aplicativo y web services</Ruta> (o <Ruta>Factura Electrónica – Monotributo – Web
              Services</Ruta> si la empresa es monotributista). Asociá el domicilio y confirmá.
            </li>
            <li>
              Cargá ese mismo número en <Ruta>Puntos de venta</Ruta> de esta aplicación, marcado como electrónico y
              activo.
            </li>
          </ol>
          <Nota>
            Un punto de venta dado de alta para facturar en línea (comprobantes en línea) no sirve para Web Services:
            tiene que ser uno propio.
          </Nota>
        </Paso>

        <Paso numero={6} titulo="Cargar las credenciales y probar la conexión">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              En <Link href="/configuracion/arca" className="text-marca-700 hover:underline">Configuración → ARCA</Link>,
              completá los datos del <Ruta>Emisor</Ruta> con la misma CUIT del certificado.
            </li>
            <li>
              En la tarjeta del ambiente que corresponda, subí el certificado (.crt) y la clave privada (.key) y tocá{" "}
              <Ruta>Guardar credenciales</Ruta>. La clave se guarda cifrada y no se vuelve a mostrar.
            </li>
            <li>
              Elegí el ambiente activo en el emisor y usá <Ruta>Probar conexión</Ruta>. Si responde bien, ya se puede
              autorizar comprobantes.
            </li>
          </ol>
        </Paso>

        <Tarjeta titulo="Problemas frecuentes">
          <dl className="space-y-3 p-4 text-sm text-stone-700">
            <div>
              <dt className="font-medium text-stone-800">&quot;El certificado es de otra CUIT&quot;</dt>
              <dd>El CSR se generó con otra CUIT en serialNumber. Generá uno nuevo con la CUIT del emisor.</dd>
            </div>
            <div>
              <dt className="font-medium text-stone-800">La clave privada no corresponde al certificado</dt>
              <dd>
                Se subió una .key distinta de la que firmó el CSR. Usá la misma del paso 1 o rehacé el proceso
                completo.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-stone-800">ARCA responde que no hay autorización (notAuthorized)</dt>
              <dd>
                Falta la relación del certificado con wsfe (paso 2 en homologación, paso 4 en producción), o todavía
                no impactó: esperá unos minutos y volvé a probar.
              </dd>
            </div>
            <div>
              <dt className="font-medium text-stone-800">El punto de venta no es válido</dt>
              <dd>En producción el número tiene que estar dado de alta para Web Services (paso 5).</dd>
            </div>
            <div>
              <dt className="font-medium text-stone-800">El certificado vence</dt>
              <dd>
                La fecha se ve en la pantalla de ARCA, que avisa cuando está por vencer. Para renovarlo, repetí los
                pasos 1 a 3 sobre el mismo alias y reemplazá las credenciales.
              </dd>
            </div>
          </dl>
        </Tarjeta>
      </div>
    </>
  );
}
