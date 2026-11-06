import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, Migas, BotonEliminar } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { numero } from "@/lib/formato";
import { MENSAJE_ARTICULO_EN_USO } from "@/lib/proveedores/errores";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { rangoMovimientos } from "@/lib/compras/cuenta-corriente/cuenta-corriente";
import type { MateriaPrimaCosto, Proveedor, ProveedorArticulo, ProveedorContacto } from "@/lib/tipos";
import {
  eliminarProveedor,
  agregarContacto,
  actualizarContacto,
  eliminarContacto,
  agregarArticulo,
  actualizarArticulo,
  eliminarArticulo,
} from "../acciones";
import { FormularioArticulo, type OpcionMateriaPrima } from "./FormularioArticulo";
import {
  CampoNombreContacto,
  CampoCargoContacto,
  CampoTelefonoContacto,
  CampoEmailContacto,
  FormularioContacto,
} from "./formularios";
import { CuentaCorriente } from "./CuentaCorriente";

export const dynamic = "force-dynamic";

/** Avisos que llegan por ?aviso= desde las acciones de artículos. */
const AVISOS: Record<string, string> = {
  "articulo-en-uso": MENSAJE_ARTICULO_EN_USO,
  "articulo-no-eliminado": "No se pudo eliminar el artículo. Intente de nuevo.",
};

type MateriaPrimaOpcion = Pick<MateriaPrimaCosto, "id" | "codigo" | "nombre" | "unidad_compra" | "activo">;

export default async function ProveedorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ articulo?: string; aviso?: string; cc_desde?: string; cc_hasta?: string }>;
}) {
  const { id } = await params;
  const { articulo: articuloEditar, aviso, cc_desde, cc_hasta } = await searchParams;
  const mensajeAviso = aviso && Object.hasOwn(AVISOS, aviso) ? AVISOS[aviso] : undefined;
  const supabase = await createClient();

  const [{ data: prov }, { data: contactosData }, { data: articulosData }, { data: materiasData }] =
    await Promise.all([
      supabase.from("proveedor").select("*").eq("id", id).maybeSingle(),
      supabase.from("proveedor_contacto").select("*").eq("proveedor_id", id).order("orden"),
      supabase
        .from("proveedor_articulo")
        .select("*")
        .eq("proveedor_id", id)
        .order("activo", { ascending: false })
        .order("descripcion"),
      supabase.from("v_materia_prima_costo").select("id, codigo, nombre, unidad_compra, activo").order("codigo"),
    ]);

  if (!prov) notFound();

  const proveedor = prov as Proveedor;
  const contactos = (contactosData ?? []) as ProveedorContacto[];
  const articulos = (articulosData ?? []) as ProveedorArticulo[];
  const materias = (materiasData ?? []) as MateriaPrimaOpcion[];
  const materiaPorId = new Map(materias.map((m) => [m.id, m]));
  const enEdicion = articulos.find((a) => a.id === articuloEditar);
  const hrefDetalle = `/proveedores/${proveedor.id}`;
  const hoy = hoyArgentina();
  const rangoCuenta = rangoMovimientos({ desde: cc_desde, hasta: cc_hasta }, hoy);

  // Se ofrecen las materias primas activas, más la del artículo en edición
  // aunque se haya desactivado, para no perder la asociación al guardar.
  const opciones = (actual?: string | null): OpcionMateriaPrima[] =>
    materias.filter((m) => m.activo || m.id === actual);

  return (
    <>
      <Migas items={[{ href: "/proveedores", texto: "Proveedores" }, { texto: proveedor.nombre }]} />
      <Encabezado
        titulo={proveedor.nombre}
        descripcion={proveedor.cuit ?? "Sin CUIT"}
        acciones={
          <>
            {proveedor.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}
            <Link href={`/proveedores?editar=${proveedor.id}`} className="boton-secundario">
              Editar datos
            </Link>
            <form action={eliminarProveedor}>
              <input type="hidden" name="id" value={proveedor.id} />
              <BotonEliminar>Eliminar</BotonEliminar>
            </form>
          </>
        }
      />

      <Tarjeta titulo="Datos fiscales" descripcion="Para registrar sus comprobantes y pagarle.">
        <dl className="grid gap-3 p-4 text-sm sm:grid-cols-4">
          <Dato titulo="Condición frente al IVA" valor={proveedor.condicion_iva} />
          <Dato titulo="Domicilio" valor={proveedor.domicilio} />
          <Dato titulo="CBU" valor={proveedor.cbu} />
          <Dato titulo="Alias" valor={proveedor.alias} />
        </dl>
      </Tarjeta>

      <CuentaCorriente proveedorId={proveedor.id} desde={rangoCuenta.desde} hasta={rangoCuenta.hasta} hoy={hoy} />

      <Tarjeta titulo="Contactos" descripcion="Personas de contacto en este proveedor.">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>Nombre</th>
                <th>Cargo</th>
                <th>Teléfono</th>
                <th>Email</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {contactos.length === 0 && (
                <Vacio mensaje="Todavía no cargaste contactos." colSpan={6} />
              )}
              {contactos.map((c) => {
                const formId = `form-contacto-${c.id}`;
                return (
                  <tr key={c.id}>
                    <td className="text-xs text-stone-400">
                      <div className="flex h-7 items-center">{c.orden}</div>
                    </td>
                    <td>
                      <CampoNombreContacto
                        formId={formId}
                        id={c.id}
                        proveedorId={proveedor.id}
                        nombre={c.nombre}
                        accion={actualizarContacto}
                      />
                    </td>
                    <td>
                      <CampoCargoContacto formId={formId} cargo={c.cargo} />
                    </td>
                    <td>
                      <CampoTelefonoContacto formId={formId} telefono={c.telefono} />
                    </td>
                    <td>
                      <CampoEmailContacto formId={formId} email={c.email} />
                    </td>
                    <td className="text-right">
                      <form action={eliminarContacto} className="flex h-7 items-center justify-end">
                        <input type="hidden" name="id" value={c.id} />
                        <input type="hidden" name="proveedor_id" value={proveedor.id} />
                        <BotonEliminar title="Eliminar contacto">×</BotonEliminar>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <FormularioContacto proveedorId={proveedor.id} accion={agregarContacto} />
      </Tarjeta>

      <Tarjeta
        titulo="Artículos del proveedor"
        descripcion="Cómo factura cada artículo este proveedor y a qué materia prima corresponde."
        acciones={
          <Modal boton="+ Agregar artículo" titulo="Nuevo artículo del proveedor">
            <FormularioArticulo
              accion={agregarArticulo}
              proveedorId={proveedor.id}
              materiasPrimas={opciones()}
            />
          </Modal>
        }
      >
        {mensajeAviso && (
          <p className="border-b border-stone-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">{mensajeAviso}</p>
        )}
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Unidad</th>
                <th className="text-right">Factor</th>
                <th>Materia prima</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {articulos.length === 0 && (
                <Vacio mensaje="Todavía no hay artículos cargados." colSpan={7} />
              )}
              {articulos.map((a) => {
                const mp = a.materia_prima_id ? materiaPorId.get(a.materia_prima_id) : undefined;
                return (
                  <tr key={a.id}>
                    <td className="text-stone-500">{a.codigo ?? "—"}</td>
                    <td className="font-medium text-stone-900">{a.descripcion}</td>
                    <td className="text-stone-500">{a.unidad ?? "—"}</td>
                    <td className="text-right tabular-nums">{numero(a.factor_conversion, 8)}</td>
                    <td className="text-stone-500">
                      {mp ? (
                        <>
                          {mp.codigo} — {mp.nombre}{" "}
                          <span className="text-xs text-stone-400">({mp.unidad_compra})</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {a.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Link
                        href={`${hrefDetalle}?articulo=${a.id}`}
                        className="mr-2 text-xs text-marca-700 hover:underline"
                      >
                        Editar
                      </Link>
                      <form action={eliminarArticulo} className="inline">
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="proveedor_id" value={proveedor.id} />
                        <BotonEliminar title="Eliminar artículo">×</BotonEliminar>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      {enEdicion && (
        <Modal titulo={`Editar artículo: ${enEdicion.descripcion}`} abierto hrefAlCerrar={hrefDetalle}>
          <FormularioArticulo
            key={enEdicion.id}
            accion={actualizarArticulo}
            proveedorId={proveedor.id}
            materiasPrimas={opciones(enEdicion.materia_prima_id)}
            articulo={enEdicion}
            cancelarHref={hrefDetalle}
          />
        </Modal>
      )}
    </>
  );
}

function Dato({ titulo, valor }: { titulo: string; valor: string | null }) {
  return (
    <div>
      <dt className="text-xs text-stone-500">{titulo}</dt>
      <dd className="mt-0.5 text-stone-900">{valor ?? "—"}</dd>
    </div>
  );
}
