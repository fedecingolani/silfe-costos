import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio } from "@/components/ui";
import { Modal } from "@/components/Modal";
import type { ClienteContacto, ClienteSeguimiento, EstadoSeguimiento, Zona } from "@/lib/tipos";
import { fecha } from "@/lib/formato";
import { fechaLocalArgentina } from "@/lib/clientes/seguimiento";
import { registrarInteraccion } from "../clientes/acciones";
import { FormularioInteraccion } from "../clientes/FormularioInteraccion";
import { PastillaSeguimiento, UltimoContacto } from "../clientes/componentes";

export const dynamic = "force-dynamic";

/** Grupos de la pantalla, en orden. Dentro de cada uno, el más viejo primero. */
const GRUPOS: { estado: EstadoSeguimiento; titulo: string; vacio: string }[] = [
  { estado: "atrasado", titulo: "Atrasados", vacio: "No hay contactos atrasados." },
  { estado: "hoy", titulo: "Hoy", vacio: "No hay contactos para hoy." },
  { estado: "proximo", titulo: "Próximos 7 días", vacio: "No hay contactos en los próximos 7 días." },
];

type ContactoAgenda = Pick<ClienteContacto, "id" | "cliente_id" | "nombre" | "cargo" | "telefono" | "whatsapp">;

/** Primer contacto del cliente (por orden) que tiene teléfono o WhatsApp. */
function contactoPrincipal(contactos: ContactoAgenda[]) {
  return contactos.find((c) => c.telefono || c.whatsapp) ?? null;
}

export default async function SeguimientoPage({
  searchParams,
}: {
  searchParams: Promise<{ zona?: string }>;
}) {
  const { zona } = await searchParams;
  // Un valor que no es un uuid haría fallar la consulta: se ignora.
  const zonaId = /^[0-9a-f-]{36}$/i.test(zona ?? "") ? (zona as string) : "";
  const supabase = await createClient();

  let consulta = supabase
    .from("v_cliente_seguimiento")
    .select("*")
    .eq("activo", true)
    .in("estado_seguimiento", GRUPOS.map((g) => g.estado))
    .order("proximo_contacto")
    .order("razon_social");
  if (zonaId) consulta = consulta.eq("zona_id", zonaId);

  const [{ data, error }, { data: zonasData }] = await Promise.all([
    consulta,
    supabase.from("zona").select("*").order("nombre"),
  ]);

  if (error) {
    return <p className="text-sm text-red-700">Error al cargar el seguimiento: {error.message}</p>;
  }

  const clientes = (data ?? []) as ClienteSeguimiento[];
  const zonas = (zonasData ?? []) as Zona[];

  const { data: contactosData } =
    clientes.length > 0
      ? await supabase
          .from("cliente_contacto")
          .select("id, cliente_id, nombre, cargo, telefono, whatsapp")
          .in(
            "cliente_id",
            clientes.map((c) => c.cliente_id),
          )
          .order("orden")
          .order("nombre")
      : { data: [] };
  const contactos = (contactosData ?? []) as ContactoAgenda[];
  const contactosPorCliente = new Map<string, ContactoAgenda[]>();
  for (const c of contactos) {
    contactosPorCliente.set(c.cliente_id, [...(contactosPorCliente.get(c.cliente_id) ?? []), c]);
  }

  const ahora = fechaLocalArgentina(new Date());
  const volver = zonaId ? `/seguimiento?zona=${zonaId}` : "/seguimiento";

  return (
    <>
      <Encabezado
        titulo="Seguimiento"
        descripcion="A quién hay que contactar: los atrasados, los de hoy y los de los próximos 7 días. Sólo clientes activos."
      />

      <form method="get" className="tarjeta mb-4 flex flex-wrap items-end gap-3 p-4">
        <div className="w-56">
          <label className="etiqueta" htmlFor="filtro-zona">
            Zona
          </label>
          <select id="filtro-zona" name="zona" defaultValue={zonaId} className="campo">
            <option value="">Todas</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.nombre}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="boton-primario">
          Filtrar
        </button>
        {zonaId && (
          <Link href="/seguimiento" className="boton-secundario">
            Limpiar
          </Link>
        )}
      </form>

      <div className="space-y-6">
        {GRUPOS.map((grupo) => {
          const filas = clientes.filter((c) => c.estado_seguimiento === grupo.estado);
          return (
            <Tarjeta key={grupo.estado} titulo={`${grupo.titulo} (${filas.length})`}>
              <div className="overflow-x-auto">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Zona</th>
                      <th>Próximo contacto</th>
                      <th>Próxima acción</th>
                      <th>Último contacto</th>
                      <th>Contacto</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filas.length === 0 && <Vacio mensaje={grupo.vacio} colSpan={7} />}
                    {filas.map((c) => {
                      const contactosCliente = contactosPorCliente.get(c.cliente_id) ?? [];
                      const principal = contactoPrincipal(contactosCliente);
                      return (
                        <tr key={c.cliente_id}>
                          <td>
                            <Link
                              href={`/clientes/${c.cliente_id}`}
                              className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                            >
                              {c.razon_social}
                            </Link>
                          </td>
                          <td className="text-stone-500">{c.zona ?? "—"}</td>
                          <td className="whitespace-nowrap">
                            <span className="mr-1.5 text-stone-700">{fecha(c.proximo_contacto)}</span>
                            <PastillaSeguimiento estado={c.estado_seguimiento} />
                          </td>
                          <td className="text-stone-700">{c.proxima_accion ?? "—"}</td>
                          <td className="text-stone-500">
                            <UltimoContacto seguimiento={c} resumen />
                          </td>
                          <td className="text-stone-500">
                            {principal ? (
                              <>
                                <span className="text-stone-700">{principal.nombre}</span>
                                {principal.telefono && (
                                  <a
                                    href={`tel:${principal.telefono}`}
                                    className="block text-xs text-marca-700 hover:underline"
                                  >
                                    Tel. {principal.telefono}
                                  </a>
                                )}
                                {principal.whatsapp && (
                                  <span className="block text-xs">WhatsApp {principal.whatsapp}</span>
                                )}
                              </>
                            ) : c.telefono ? (
                              <a href={`tel:${c.telefono}`} className="text-xs text-marca-700 hover:underline">
                                Tel. {c.telefono}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="whitespace-nowrap text-right">
                            <Modal
                              key={`${c.cliente_id}-${c.ultima_interaccion_id ?? "nueva"}`}
                              boton="Registrar"
                              titulo={`Registrar contacto: ${c.razon_social}`}
                            >
                              <FormularioInteraccion
                                clienteId={c.cliente_id}
                                accion={registrarInteraccion}
                                contactos={contactosCliente}
                                ahora={ahora}
                                volver={volver}
                              />
                            </Modal>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Tarjeta>
          );
        })}
      </div>
    </>
  );
}
