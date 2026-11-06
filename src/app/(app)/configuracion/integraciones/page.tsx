import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta } from "@/components/ui";
import { fechaHora } from "@/lib/formato";
import { ENDPOINTS_API, filaClave, urlBaseApi } from "@/lib/api/integraciones";
import type { ApiClaveVisible } from "@/lib/tipos";
import { crearClave, revocarClave } from "./acciones";
import { ClavesApi } from "./ClavesApi";

export const dynamic = "force-dynamic";

// Columnas explícitas: el hash de la clave nunca se lee en la pantalla.
const COLUMNAS_CLAVE = "id, nombre, prefijo, creado_en, revocada_en, ultimo_uso_en";

export default async function IntegracionesPage() {
  const supabase = await createClient();
  const [{ data, error }, encabezados] = await Promise.all([
    supabase.from("api_clave").select(COLUMNAS_CLAVE).order("revocada_en", { nullsFirst: true }).order("creado_en", {
      ascending: false,
    }),
    headers(),
  ]);
  if (error) {
    return <p className="text-sm text-red-700">Error al cargar las claves de API: {error.message}</p>;
  }

  const claves = ((data ?? []) as ApiClaveVisible[]).map((c) => filaClave(c, fechaHora));
  const urlBase = urlBaseApi(
    encabezados.get("x-forwarded-host") ?? encabezados.get("host"),
    encabezados.get("x-forwarded-proto"),
  );

  return (
    <>
      <Encabezado
        titulo="Integraciones"
        descripcion="Claves de API para que otros sistemas (como Factura Digital) consulten proveedores y envíen comprobantes de compra. La clave completa se muestra una sola vez, al crearla."
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_26rem] lg:items-start">
        <Tarjeta titulo="Claves de API" descripcion="Una clave revocada no autentica más, pero queda en la lista.">
          <ClavesApi claves={claves} crear={crearClave} revocar={revocarClave} />
        </Tarjeta>

        <Tarjeta titulo="Cómo se configura la integración">
          <div className="space-y-3 p-4 text-sm text-stone-600">
            <div>
              <p className="etiqueta">URL base</p>
              <code className="block break-all rounded-lg bg-stone-100 px-3 py-2 font-mono text-xs text-stone-800">
                {urlBase ?? "/api/v1"}
              </code>
            </div>
            <div>
              <p className="etiqueta">Autenticación</p>
              <code className="block break-all rounded-lg bg-stone-100 px-3 py-2 font-mono text-xs text-stone-800">
                Authorization: Bearer &lt;clave&gt;
              </code>
            </div>
            <div>
              <p className="etiqueta">Endpoints</p>
              <ul className="space-y-2">
                {ENDPOINTS_API.map((e) => (
                  <li key={`${e.metodo} ${e.ruta}`}>
                    <code className="font-mono text-xs text-stone-800">
                      <span className="font-semibold">{e.metodo}</span> {e.ruta}
                    </code>
                    <p className="text-xs text-stone-500">{e.descripcion}</p>
                  </li>
                ))}
              </ul>
            </div>
            <p className="text-xs text-stone-500">
              Los comprobantes entran siempre en borrador: alguien los revisa, asocia cada artículo a una materia
              prima y los confirma. El proveedor tiene que existir antes (se busca por CUIT).
            </p>
          </div>
        </Tarjeta>
      </div>
    </>
  );
}
