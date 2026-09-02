import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, Migas, Kpi, BotonEliminar } from "@/components/ui";
import { pesos, numero, porcentaje, fecha } from "@/lib/formato";
import type {
  MateriaPrima,
  MateriaPrimaCosto,
  PrecioMateriaPrima,
  Proveedor,
  UnidadMedida,
  UsoMateriaPrima,
} from "@/lib/tipos";
import { eliminarMateriaPrima, agregarPrecio, marcarPreferido, eliminarPrecio } from "../acciones";
import { FormEditarMateriaPrima } from "./FormEditarMateriaPrima";

export const dynamic = "force-dynamic";

type PrecioConProveedor = PrecioMateriaPrima & { proveedor: { nombre: string } | null };

export default async function MateriaPrimaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: mp }, { data: costo }, { data: precios }, { data: unidades }, { data: proveedores }, { data: usos }] =
    await Promise.all([
      supabase.from("materia_prima").select("*").eq("id", id).maybeSingle(),
      supabase.from("v_materia_prima_costo").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("precio_materia_prima")
        .select("*, proveedor:proveedor_id(nombre)")
        .eq("materia_prima_id", id)
        .order("vigente_desde", { ascending: false }),
      supabase.from("unidad_medida").select("*").order("codigo"),
      supabase.from("proveedor").select("*").eq("activo", true).order("nombre"),
      supabase.from("v_uso_materia_prima").select("*").eq("materia_prima_id", id),
    ]);

  if (!mp) notFound();

  const materia = mp as MateriaPrima;
  const c = costo as MateriaPrimaCosto | null;
  const listaPrecios = (precios ?? []) as unknown as PrecioConProveedor[];
  const listaUnidades = (unidades ?? []) as UnidadMedida[];
  const listaProveedores = (proveedores ?? []) as Proveedor[];
  const listaUsos = (usos ?? []) as UsoMateriaPrima[];

  return (
    <>
      <Migas items={[{ href: "/materias-primas", texto: "Materias primas" }, { texto: materia.nombre }]} />
      <Encabezado
        titulo={materia.nombre}
        descripcion={`${materia.codigo}${materia.categoria ? ` · ${materia.categoria}` : ""}`}
        acciones={
          <form action={eliminarMateriaPrima}>
            <input type="hidden" name="id" value={materia.id} />
            <BotonEliminar>Eliminar materia prima</BotonEliminar>
          </form>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          etiqueta="Precio de compra"
          valor={pesos(c?.precio_compra)}
          detalle={`por ${c?.unidad_compra ?? "—"}${c?.proveedor ? ` · ${c.proveedor}` : ""}`}
        />
        <Kpi
          etiqueta="Rendimiento"
          valor={`${numero(materia.factor_conversion)} ${c?.unidad_uso ?? ""}`}
          detalle={`por cada ${c?.unidad_compra ?? "unidad"} comprada`}
        />
        <Kpi
          etiqueta="Costo por unidad de uso"
          valor={pesos(c?.costo_unitario_uso, true)}
          detalle={`por ${c?.unidad_uso ?? "—"}, sin merma`}
        />
        <Kpi
          etiqueta="Costo con merma"
          valor={pesos(c?.costo_unitario_uso_con_merma, true)}
          detalle={`merma ${porcentaje(materia.merma_pct)}`}
          acento
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem] xl:items-start">
        <div className="space-y-6">
          <Tarjeta titulo="Precios y proveedores" descripcion="Se usa el precio preferido; si no hay, el más reciente.">
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Proveedor</th>
                    <th className="num">Precio</th>
                    <th className="num">Costo por {c?.unidad_uso ?? "uso"}</th>
                    <th>Vigente desde</th>
                    <th>IVA</th>
                    <th>Observaciones</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {listaPrecios.length === 0 && <Vacio mensaje="Sin precios cargados." colSpan={7} />}
                  {listaPrecios.map((p) => (
                    <tr key={p.id} className={p.es_preferido ? "bg-marca-50/60" : undefined}>
                      <td>
                        <span className="font-medium text-stone-900">{p.proveedor?.nombre ?? "Sin proveedor"}</span>
                        {p.es_preferido && (
                          <span className="ml-2">
                            <Pastilla tono="verde">Preferido</Pastilla>
                          </span>
                        )}
                      </td>
                      <td className="num">{pesos(p.precio)}</td>
                      <td className="num text-stone-600">
                        {pesos(p.precio / materia.factor_conversion / (1 - materia.merma_pct / 100), true)}
                      </td>
                      <td className="text-stone-500">{fecha(p.vigente_desde)}</td>
                      <td className="text-stone-500">{p.incluye_iva ? "Con IVA" : "Sin IVA"}</td>
                      <td className="max-w-[16rem] truncate text-xs text-stone-400" title={p.observaciones ?? ""}>
                        {p.observaciones ?? "—"}
                      </td>
                      <td className="whitespace-nowrap text-right">
                        {!p.es_preferido && (
                          <form action={marcarPreferido} className="inline">
                            <input type="hidden" name="materia_prima_id" value={materia.id} />
                            <input type="hidden" name="precio_id" value={p.id} />
                            <button className="mr-2 text-xs text-marca-700 hover:underline">Usar este</button>
                          </form>
                        )}
                        <form action={eliminarPrecio} className="inline">
                          <input type="hidden" name="materia_prima_id" value={materia.id} />
                          <input type="hidden" name="precio_id" value={p.id} />
                          <BotonEliminar />
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form action={agregarPrecio} className="grid gap-3 border-t border-stone-200 bg-stone-50 p-4 sm:grid-cols-5">
              <input type="hidden" name="materia_prima_id" value={materia.id} />
              <div>
                <label className="etiqueta">Proveedor</label>
                <select name="proveedor_id" className="campo" defaultValue="">
                  <option value="">—</option>
                  {listaProveedores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="etiqueta">Precio / {c?.unidad_compra ?? "compra"}</label>
                <input name="precio" required className="campo" />
              </div>
              <div>
                <label className="etiqueta">Vigente desde</label>
                <input name="vigente_desde" type="date" className="campo" />
              </div>
              <div className="sm:col-span-2">
                <label className="etiqueta">Observaciones</label>
                <input name="observaciones" className="campo" />
              </div>
              <div className="flex flex-wrap items-center gap-4 sm:col-span-5">
                <label className="flex items-center gap-2 text-sm text-stone-600">
                  <input type="checkbox" name="es_preferido" defaultChecked className="rounded" />
                  Usar como precio de costeo
                </label>
                <label className="flex items-center gap-2 text-sm text-stone-600">
                  <input type="checkbox" name="incluye_iva" className="rounded" />
                  El precio incluye IVA
                </label>
                <button className="boton-primario ml-auto">Agregar precio</button>
              </div>
            </form>
          </Tarjeta>

          <Tarjeta
            titulo="Dónde se usa"
            descripcion="Productos y subgrupos afectados por un cambio de precio de este material."
          >
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Vía</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Costo por unidad de producto</th>
                  </tr>
                </thead>
                <tbody>
                  {listaUsos.length === 0 && (
                    <Vacio mensaje="Todavía no se usa en ninguna estructura." colSpan={4} />
                  )}
                  {listaUsos.map((u) => (
                    <tr key={`${u.producto_id}-${u.subgrupo_nombre ?? "directo"}`}>
                      <td>
                        <Link
                          href={`/productos/${u.producto_id}`}
                          className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                        >
                          {u.producto_nombre}
                        </Link>
                        <div className="text-xs text-stone-400">{u.producto_codigo}</div>
                      </td>
                      <td className="text-stone-500">
                        {u.subgrupo_nombre ? <Pastilla tono="azul">{u.subgrupo_nombre}</Pastilla> : "Directo"}
                      </td>
                      <td className="num">
                        {numero(u.cantidad)} {c?.unidad_uso}
                      </td>
                      <td className="num font-medium">{pesos(u.costo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Tarjeta>
        </div>

        <Tarjeta titulo="Datos del material">
          <FormEditarMateriaPrima materia={materia} listaUnidades={listaUnidades} />
        </Tarjeta>
      </div>
    </>
  );
}
