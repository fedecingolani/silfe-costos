import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta } from "@/components/ui";
import { fecha, fechaHora, numero, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { NOMBRES_ESTADO_COMPROBANTE_COMPRA, TONO_ESTADO_COMPROBANTE_COMPRA } from "@/lib/compras/comprobantes/listado";
import { numeroComprobanteCompra } from "@/lib/compras/comprobantes/numero";
import {
  NOMBRES_ESTADO_REMITO_COMPRA,
  NOMBRES_FACTURACION_REMITO_COMPRA,
  TONO_ESTADO_REMITO_COMPRA,
  estadoVisibleRemitoCompra,
  numeroRemitoCompra,
  permisosRemitoCompra,
} from "@/lib/compras/remitos/listado";
import type { CondicionIva } from "@/lib/tipos";
import { cargarArticulos, cargarContextoEditorCompra } from "../../comprobantes/datos";
import { AccionesRemitoCompra } from "../AccionesRemitoCompra";
import { cargarFacturasDelRemito, cargarPendientesDelRemito, cargarRemitoCompra } from "../datos";
import { EditorRemitoCompra } from "../EditorRemitoCompra";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
    </div>
  );
}

export default async function RemitoCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const cargado = await cargarRemitoCompra(supabase, id);
  if (typeof cargado === "string") return <p className="text-sm text-red-700">Error al cargar el remito: {cargado}</p>;
  if (!cargado) notFound();
  const { remito: r, items, facturacion } = cargado;
  const estado = estadoVisibleRemitoCompra(r.estado, facturacion);
  const permisos = permisosRemitoCompra(estado);

  const titulo = `Remito ${numeroRemitoCompra(r)}`;
  const pastilla = <Pastilla tono={TONO_ESTADO_REMITO_COMPRA[estado]}>{NOMBRES_ESTADO_REMITO_COMPRA[estado]}</Pastilla>;
  const migas = <Migas items={[{ href: "/compras/remitos", texto: "Remitos de compra" }, { texto: titulo }]} />;

  // ----- Borrador: se edita ------------------------------------------------------

  if (permisos.puedeEditar) {
    const [contexto, articulos] = await Promise.all([
      cargarContextoEditorCompra(supabase),
      cargarArticulos(supabase, r.proveedor_id),
    ]);
    if (typeof contexto === "string" || typeof articulos === "string") {
      const error = [contexto, articulos].find((v) => typeof v === "string");
      return <p className="text-sm text-red-700">Error al cargar los datos del remito: {error as string}</p>;
    }
    return (
      <>
        {migas}
        <Encabezado
          titulo={titulo}
          descripcion="Borrador: se puede editar, borrar o registrar como recibido. Recibido ya no se modifica."
          acciones={pastilla}
        />
        <EditorRemitoCompra guardado={cargado} contexto={contexto} articulos={articulos} hoy={hoyArgentina()} />
      </>
    );
  }

  // ----- Recibido o anulado: sólo lectura -----------------------------------------

  const materiaIds = [...new Set(items.map((i) => i.materia_prima_id).filter((v): v is string => v !== null))];
  const [{ data: proveedorData }, { data: materiasData, error: errorMaterias }, pendientes, facturas] = await Promise.all([
    supabase.from("proveedor").select("id, nombre, cuit, condicion_iva").eq("id", r.proveedor_id).maybeSingle(),
    materiaIds.length > 0
      ? supabase.from("materia_prima").select("id, codigo, nombre").in("id", materiaIds)
      : Promise.resolve({ data: [], error: null }),
    cargarPendientesDelRemito(supabase, r.id),
    cargarFacturasDelRemito(
      supabase,
      items.map((i) => i.id),
    ),
  ]);
  if (errorMaterias) {
    return <p className="text-sm text-red-700">Error al cargar las materias primas: {errorMaterias.message}</p>;
  }
  if (typeof pendientes === "string") return <p className="text-sm text-red-700">{pendientes}</p>;
  if (typeof facturas === "string") return <p className="text-sm text-red-700">{facturas}</p>;
  const proveedor = proveedorData as { id: string; nombre: string; cuit: string | null; condicion_iva: CondicionIva | null } | null;
  const materias = new Map(((materiasData ?? []) as { id: string; codigo: string; nombre: string }[]).map((m) => [m.id, m]));
  const facturadoPorItem = new Map(pendientes.map((p) => [p.remito_compra_item_id, p]));

  const descripcion =
    r.estado === "anulado"
      ? `Anulado el ${fechaHora(r.anulado_en)}: conserva sus datos, ya no se factura.`
      : estado === "facturado"
        ? "Facturado por completo: ya no se modifica."
        : estado === "parcial"
          ? "Facturado en parte: ya no se modifica. Lo pendiente se puede facturar."
          : `Recibido el ${fechaHora(r.recibido_en)}: ya no se modifica. Se factura o, sin nada facturado, se anula.`;
  const hayAcciones = permisos.puedeFacturar || permisos.puedeAnular;

  return (
    <>
      {migas}
      <Encabezado titulo={titulo} descripcion={descripcion} acciones={pastilla} />

      {hayAcciones && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <AccionesRemitoCompra id={r.id} proveedorId={r.proveedor_id} estado={estado} />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Remito">
          <dl className="grid grid-cols-2 gap-3 p-4">
            <Dato etiqueta="Número del proveedor">{numeroRemitoCompra(r)}</Dato>
            <Dato etiqueta="Fecha">{fecha(r.fecha)}</Dato>
            <Dato etiqueta="Recibido">{fechaHora(r.recibido_en)}</Dato>
            {r.anulado_en && <Dato etiqueta="Anulado">{fechaHora(r.anulado_en)}</Dato>}
            {r.estado === "recibido" && <Dato etiqueta="Facturación">{NOMBRES_FACTURACION_REMITO_COMPRA[facturacion]}</Dato>}
            {r.observaciones && (
              <div className="col-span-2">
                <Dato etiqueta="Observaciones">{r.observaciones}</Dato>
              </div>
            )}
          </dl>
        </Tarjeta>
        <Tarjeta titulo="Proveedor">
          <dl className="grid grid-cols-2 gap-3 p-4">
            <div className="col-span-2">
              <Dato etiqueta="Nombre">
                {proveedor ? (
                  <Link href={`/proveedores/${proveedor.id}`} className="text-marca-700 hover:underline">
                    {proveedor.nombre}
                  </Link>
                ) : (
                  "—"
                )}
              </Dato>
            </div>
            <Dato etiqueta="CUIT">{proveedor?.cuit ?? "—"}</Dato>
            <Dato etiqueta="Condición IVA">{proveedor?.condicion_iva ?? "—"}</Dato>
          </dl>
        </Tarjeta>
      </div>

      <Tarjeta titulo="Renglones" className="mt-4">
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th>Código</th>
                <th>Descripción</th>
                <th>Materia prima</th>
                <th className="text-right">Cantidad</th>
                <th className="text-right">Facturado</th>
                <th className="text-right">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const materia = i.materia_prima_id ? materias.get(i.materia_prima_id) : undefined;
                const f = facturadoPorItem.get(i.id);
                return (
                  <tr key={i.id}>
                    <td className="tabular-nums">{i.codigo_proveedor ?? "—"}</td>
                    <td className="whitespace-pre-wrap">{i.descripcion}</td>
                    <td>{materia ? `${materia.codigo} — ${materia.nombre}` : "—"}</td>
                    <td className="text-right tabular-nums">
                      {numero(i.cantidad, 4)} {i.unidad ?? ""}
                    </td>
                    <td className="text-right tabular-nums">{f ? numero(f.facturada, 4) : "—"}</td>
                    <td
                      className={`text-right tabular-nums ${f && f.pendiente > 0 && r.estado === "recibido" ? "font-medium text-amber-800" : ""}`}
                    >
                      {f ? numero(f.pendiente, 4) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo="Facturas"
        descripcion="Comprobantes con renglones de este remito. Los borradores y confirmados cuentan como facturado; los anulados, no."
        className="mt-4"
      >
        {facturas.length === 0 ? (
          <p className="p-4 text-sm text-stone-500">Todavía no se facturó nada de este remito.</p>
        ) : (
          <ul className="divide-y divide-stone-200">
            {facturas.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm">
                <Link href={`/compras/comprobantes/${c.id}`} className="font-medium text-marca-700 hover:underline">
                  {numeroComprobanteCompra(c)}
                </Link>
                <span className="flex items-center gap-2">
                  <span className="text-stone-500">{fecha(c.fecha)}</span>
                  <span className="tabular-nums">{pesos(c.total)}</span>
                  <Pastilla tono={TONO_ESTADO_COMPROBANTE_COMPRA[c.estado]}>{NOMBRES_ESTADO_COMPROBANTE_COMPRA[c.estado]}</Pastilla>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Tarjeta>
    </>
  );
}
