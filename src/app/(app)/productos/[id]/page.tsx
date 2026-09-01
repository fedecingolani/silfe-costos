import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Pastilla, Migas, Kpi, BotonEliminar } from "@/components/ui";
import { pesos, numero, porcentaje, minutosAHoras } from "@/lib/formato";
import type {
  CategoriaManoObra,
  ComponenteDetalle,
  ExplosionMaterial,
  MateriaPrimaCosto,
  Proceso,
  ProcesoCosto,
  Producto,
  ProductoCosto,
  UnidadMedida,
} from "@/lib/tipos";
import {
  actualizarProducto,
  eliminarProducto,
  duplicarProducto,
  agregarComponente,
  actualizarComponente,
  eliminarComponente,
  agregarProcesoAProducto,
  actualizarProcesoDeProducto,
  eliminarProcesoDeProducto,
} from "../acciones";
import { FormularioComponente, FormularioProceso } from "./formularios";

export const dynamic = "force-dynamic";

export default async function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: prod },
    { data: costoData },
    { data: componentesData },
    { data: procesosData },
    { data: explosionData },
    { data: materiasData },
    { data: subgruposData },
    { data: catalogoProcesos },
    { data: categoriasData },
    { data: unidadesData },
  ] = await Promise.all([
    supabase.from("producto").select("*").eq("id", id).maybeSingle(),
    supabase.from("v_producto_costo").select("*").eq("id", id).maybeSingle(),
    supabase.from("v_componente_detalle").select("*").eq("producto_id", id).order("orden"),
    supabase.from("v_proceso_costo").select("*").eq("producto_id", id).order("orden"),
    supabase.from("v_explosion_materiales").select("*").eq("producto_id", id),
    supabase.from("v_materia_prima_costo").select("*").eq("activo", true).order("codigo"),
    supabase.from("v_producto_costo").select("*").eq("tipo", "SUBGRUPO").order("codigo"),
    supabase.from("proceso").select("*").eq("activo", true).order("codigo"),
    supabase.from("categoria_mano_obra").select("*").eq("activo", true).order("nombre"),
    supabase.from("unidad_medida").select("*").order("codigo"),
  ]);

  if (!prod) notFound();

  const producto = prod as Producto;
  const costo = costoData as ProductoCosto | null;
  const componentes = (componentesData ?? []) as ComponenteDetalle[];
  const procesos = (procesosData ?? []) as ProcesoCosto[];
  const explosion = (explosionData ?? []) as ExplosionMaterial[];
  const materias = (materiasData ?? []) as MateriaPrimaCosto[];
  const subgrupos = ((subgruposData ?? []) as ProductoCosto[]).filter((s) => s.id !== producto.id);
  const listaProcesos = (catalogoProcesos ?? []) as Proceso[];
  const categorias = (categoriasData ?? []) as CategoriaManoObra[];
  const unidades = (unidadesData ?? []) as UnidadMedida[];

  const esTerminado = producto.tipo === "TERMINADO";
  const faltanPrecios = componentes.some((c) => c.sin_precio);
  const costoTotal = costo?.costo_total ?? 0;
  const parte = (valor: number) => (costoTotal > 0 ? (valor / costoTotal) * 100 : 0);

  return (
    <>
      <Migas items={[{ href: "/productos", texto: "Productos" }, { texto: producto.nombre }]} />
      <Encabezado
        titulo={producto.nombre}
        descripcion={`${producto.codigo}${producto.descripcion ? ` · ${producto.descripcion}` : ""}`}
        acciones={
          <>
            {esTerminado ? <Pastilla tono="verde">Terminado</Pastilla> : <Pastilla tono="azul">Subgrupo</Pastilla>}
            <form action={duplicarProducto}>
              <input type="hidden" name="id" value={producto.id} />
              <button className="boton-secundario">Duplicar</button>
            </form>
            <form action={eliminarProducto}>
              <input type="hidden" name="id" value={producto.id} />
              <BotonEliminar>Eliminar</BotonEliminar>
            </form>
          </>
        }
      />

      {faltanPrecios && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Hay materias primas sin precio cargado en esta estructura: el costo mostrado está incompleto.
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Kpi
          etiqueta="Materiales"
          valor={pesos(costo?.costo_materiales)}
          detalle={`${porcentaje(parte(costo?.costo_materiales ?? 0))} del costo`}
        />
        <Kpi
          etiqueta="Mano de obra"
          valor={pesos(costo?.costo_mano_obra)}
          detalle={minutosAHoras(costo?.minutos_totales)}
        />
        <Kpi
          etiqueta={`Gastos generales (${porcentaje(costo?.gastos_generales_pct)})`}
          valor={pesos(costo?.gastos_generales)}
        />
        <Kpi etiqueta="Costo total" valor={pesos(costo?.costo_total)} acento />
        <Kpi
          etiqueta="Precio sugerido"
          valor={pesos(costo?.precio_sugerido)}
          detalle={`margen ${porcentaje(costo?.margen_pct)}`}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_22rem] xl:items-start">
        <div className="space-y-6">
          {/* -------- Estructura -------- */}
          <Tarjeta
            titulo="Estructura"
            descripcion={
              esTerminado
                ? "Subgrupos y materias primas que componen el producto."
                : "Materias primas que componen este subgrupo."
            }
          >
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>Componente</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Merma uso</th>
                    <th className="num">Cant. c/merma</th>
                    <th className="num">Costo unitario</th>
                    <th className="num">Subtotal</th>
                    <th className="num">%</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {componentes.length === 0 && (
                    <Vacio mensaje="Todavía no cargaste componentes." colSpan={9} />
                  )}
                  {componentes.map((c) => (
                    <tr key={c.id}>
                      <td className="text-xs text-stone-400">{c.orden}</td>
                      <td>
                        <div className="flex items-center gap-2">
                          {c.tipo === "SUBGRUPO" ? (
                            <Pastilla tono="azul">Subgrupo</Pastilla>
                          ) : (
                            <Pastilla>MP</Pastilla>
                          )}
                          {c.tipo === "SUBGRUPO" ? (
                            <Link
                              href={`/productos/${c.subgrupo_id}`}
                              className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                            >
                              {c.nombre}
                            </Link>
                          ) : (
                            <Link
                              href={`/materias-primas/${c.materia_prima_id}`}
                              className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                            >
                              {c.nombre}
                            </Link>
                          )}
                        </div>
                        <div className="text-xs text-stone-400">
                          {c.codigo}
                          {c.proveedor ? ` · ${c.proveedor}` : ""}
                          {c.notas ? ` · ${c.notas}` : ""}
                        </div>
                      </td>
                      <td className="num">
                        <form action={actualizarComponente} className="flex items-center justify-end gap-1">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="producto_id" value={producto.id} />
                          <input
                            name="cantidad"
                            defaultValue={c.cantidad}
                            className="campo mt-0 w-20 px-2 py-1 text-right text-xs"
                          />
                          <input
                            name="merma_pct"
                            defaultValue={c.merma_pct}
                            className="campo mt-0 w-14 px-2 py-1 text-right text-xs"
                          />
                          <button className="boton-secundario px-2 py-1 text-xs">✓</button>
                        </form>
                        <div className="mt-0.5 text-xs text-stone-400">{c.unidad}</div>
                      </td>
                      <td className="num text-xs text-stone-500">{porcentaje(c.merma_pct)}</td>
                      <td className="num text-stone-600">
                        {numero(c.cantidad_con_merma, 4)} {c.unidad}
                      </td>
                      <td className="num">
                        {c.sin_precio ? <Pastilla tono="ambar">Sin precio</Pastilla> : pesos(c.costo_unitario, true)}
                      </td>
                      <td className="num font-medium text-stone-900">{pesos(c.costo_total)}</td>
                      <td className="num text-xs text-stone-400">{porcentaje(parte(c.costo_total ?? 0))}</td>
                      <td className="text-right">
                        <form action={eliminarComponente}>
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="producto_id" value={producto.id} />
                          <BotonEliminar />
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {componentes.length > 0 && (
                  <tfoot>
                    <tr className="bg-stone-50 font-semibold">
                      <td colSpan={6} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-stone-500">
                        Total materiales y subgrupos
                      </td>
                      <td className="num px-3 py-2">
                        {pesos(componentes.reduce((acc, c) => acc + (c.costo_total ?? 0), 0))}
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <FormularioComponente
              productoId={producto.id}
              permiteSubgrupos={esTerminado}
              materias={materias}
              subgrupos={subgrupos}
              accion={agregarComponente}
            />
          </Tarjeta>

          {/* -------- Procesos -------- */}
          <Tarjeta
            titulo="Mano de obra"
            descripcion="Procesos aplicados a este producto, por unidad producida."
          >
            <div className="overflow-x-auto">
              <table className="tabla">
                <thead>
                  <tr>
                    <th className="w-8">#</th>
                    <th>Proceso</th>
                    <th>Modo</th>
                    <th className="num">Minutos / Costo fijo</th>
                    <th>Categoría</th>
                    <th className="num">U./ciclo</th>
                    <th className="num">Costo por unidad</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {procesos.length === 0 && <Vacio mensaje="Sin procesos asignados." colSpan={8} />}
                  {procesos.map((p) => (
                    <tr key={p.id}>
                      <td className="text-xs text-stone-400">{p.orden}</td>
                      <td>
                        <div className="font-medium text-stone-900">{p.proceso}</div>
                        <div className="text-xs text-stone-400">
                          {p.proceso_codigo}
                          {p.notas ? ` · ${p.notas}` : ""}
                        </div>
                      </td>
                      <td>
                        {p.modo === "TIEMPO" ? (
                          <Pastilla tono="verde">Tiempo</Pastilla>
                        ) : (
                          <Pastilla tono="ambar">Fijo</Pastilla>
                        )}
                      </td>
                      <td className="num">
                        <form
                          action={actualizarProcesoDeProducto}
                          className="flex items-center justify-end gap-1"
                        >
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="producto_id" value={producto.id} />
                          <input type="hidden" name="modo" value={p.modo} />
                          {p.modo === "TIEMPO" ? (
                            <>
                              <input
                                name="minutos"
                                defaultValue={p.minutos ?? 0}
                                className="campo mt-0 w-16 px-2 py-1 text-right text-xs"
                              />
                              <select
                                name="categoria_mano_obra_id"
                                defaultValue={p.categoria_mano_obra_id ?? ""}
                                className="campo mt-0 w-32 px-2 py-1 text-xs"
                              >
                                {categorias.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.nombre}
                                  </option>
                                ))}
                              </select>
                            </>
                          ) : (
                            <input
                              name="costo_fijo"
                              defaultValue={p.costo_fijo ?? 0}
                              className="campo mt-0 w-24 px-2 py-1 text-right text-xs"
                            />
                          )}
                          <input
                            name="cantidad_por_ciclo"
                            defaultValue={p.cantidad_por_ciclo}
                            className="campo mt-0 w-14 px-2 py-1 text-right text-xs"
                          />
                          <button className="boton-secundario px-2 py-1 text-xs">✓</button>
                        </form>
                      </td>
                      <td className="text-stone-500">
                        {p.categoria ?? "—"}
                        {p.costo_hora_cargado && (
                          <div className="text-xs text-stone-400">{pesos(p.costo_hora_cargado)}/h</div>
                        )}
                      </td>
                      <td className="num text-stone-500">{numero(p.cantidad_por_ciclo, 2)}</td>
                      <td className="num font-medium text-stone-900">{pesos(p.costo)}</td>
                      <td className="text-right">
                        <form action={eliminarProcesoDeProducto}>
                          <input type="hidden" name="id" value={p.id} />
                          <input type="hidden" name="producto_id" value={producto.id} />
                          <BotonEliminar />
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {procesos.length > 0 && (
                  <tfoot>
                    <tr className="bg-stone-50 font-semibold">
                      <td colSpan={6} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-stone-500">
                        Mano de obra propia ({minutosAHoras(procesos.reduce((a, p) => a + p.minutos_por_unidad, 0))})
                      </td>
                      <td className="num px-3 py-2">
                        {pesos(procesos.reduce((a, p) => a + (p.costo ?? 0), 0))}
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>

            <FormularioProceso
              productoId={producto.id}
              procesos={listaProcesos}
              categorias={categorias}
              accion={agregarProcesoAProducto}
            />
          </Tarjeta>

          {/* -------- Explosión de materiales -------- */}
          {esTerminado && explosion.length > 0 && (
            <Tarjeta
              titulo="Explosión de materiales"
              descripcion="Todas las materias primas que consume una unidad, atravesando los subgrupos."
            >
              <div className="overflow-x-auto">
                <table className="tabla">
                  <thead>
                    <tr>
                      <th>Materia prima</th>
                      <th>Origen</th>
                      <th>Proveedor</th>
                      <th className="num">Cantidad</th>
                      <th className="num">Costo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {explosion
                      .slice()
                      .sort((a, b) => b.costo - a.costo)
                      .map((e, i) => (
                        <tr key={`${e.materia_prima_id}-${e.subgrupo_id ?? "d"}-${i}`}>
                          <td>
                            <Link
                              href={`/materias-primas/${e.materia_prima_id}`}
                              className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                            >
                              {e.nombre}
                            </Link>
                            <div className="text-xs text-stone-400">{e.codigo}</div>
                          </td>
                          <td>
                            {e.subgrupo_nombre ? (
                              <Pastilla tono="azul">{e.subgrupo_nombre}</Pastilla>
                            ) : (
                              <span className="text-stone-500">Directo</span>
                            )}
                          </td>
                          <td className="text-stone-500">{e.proveedor ?? "—"}</td>
                          <td className="num">
                            {numero(e.cantidad, 4)} {e.unidad}
                          </td>
                          <td className="num font-medium">{pesos(e.costo)}</td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-stone-50 font-semibold">
                      <td colSpan={4} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-stone-500">
                        Total materiales
                      </td>
                      <td className="num px-3 py-2">
                        {pesos(explosion.reduce((a, e) => a + e.costo, 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Tarjeta>
          )}
        </div>

        {/* -------- Panel lateral -------- */}
        <div className="space-y-6">
          <Tarjeta titulo="Apertura del costo">
            <dl className="divide-y divide-stone-100 text-sm">
              {[
                ["Materias primas directas", costo?.materiales_directos],
                ["Materiales vía subgrupos", costo?.materiales_subgrupos],
                ["Mano de obra propia", costo?.mano_obra_directa],
                ["Mano de obra de subgrupos", costo?.mano_obra_subgrupos],
              ].map(([texto, valor]) => (
                <div key={texto as string} className="flex justify-between px-4 py-2">
                  <dt className="text-stone-600">{texto as string}</dt>
                  <dd className="tabular-nums text-stone-900">{pesos(valor as number)}</dd>
                </div>
              ))}
              <div className="flex justify-between bg-stone-50 px-4 py-2 font-medium">
                <dt>Costo directo</dt>
                <dd className="tabular-nums">{pesos(costo?.costo_directo)}</dd>
              </div>
              <div className="flex justify-between px-4 py-2">
                <dt className="text-stone-600">Gastos generales ({porcentaje(costo?.gastos_generales_pct)})</dt>
                <dd className="tabular-nums text-stone-900">{pesos(costo?.gastos_generales)}</dd>
              </div>
              <div className="flex justify-between bg-marca-50 px-4 py-2 font-semibold text-marca-900">
                <dt>Costo total</dt>
                <dd className="tabular-nums">{pesos(costo?.costo_total)}</dd>
              </div>
              <div className="flex justify-between px-4 py-2">
                <dt className="text-stone-600">Precio sugerido ({porcentaje(costo?.margen_pct)})</dt>
                <dd className="tabular-nums font-medium text-stone-900">{pesos(costo?.precio_sugerido)}</dd>
              </div>
            </dl>
            <p className="border-t border-stone-100 px-4 py-2 text-xs text-stone-400">
              Los porcentajes de gastos generales y margen se configuran en{" "}
              <Link href="/configuracion" className="text-marca-700 hover:underline">
                Parámetros
              </Link>
              .
            </p>
          </Tarjeta>

          <Tarjeta titulo="Datos del producto">
            <form action={actualizarProducto} className="space-y-3 p-4">
              <input type="hidden" name="id" value={producto.id} />
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="etiqueta">Código *</label>
                  <input name="codigo" required defaultValue={producto.codigo} className="campo" />
                </div>
                <div className="col-span-2">
                  <label className="etiqueta">Nombre *</label>
                  <input name="nombre" required defaultValue={producto.nombre} className="campo" />
                </div>
              </div>
              <div>
                <label className="etiqueta">Tipo</label>
                <select name="tipo" defaultValue={producto.tipo} className="campo">
                  <option value="TERMINADO">Producto terminado</option>
                  <option value="SUBGRUPO">Subgrupo</option>
                </select>
              </div>
              <div>
                <label className="etiqueta">Unidad</label>
                <select name="unidad_id" defaultValue={producto.unidad_id ?? ""} className="campo">
                  <option value="">—</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.codigo} · {u.nombre}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="etiqueta">Descripción</label>
                <textarea name="descripcion" rows={3} defaultValue={producto.descripcion ?? ""} className="campo" />
              </div>
              <label className="flex items-center gap-2 text-sm text-stone-600">
                <input type="checkbox" name="activo" defaultChecked={producto.activo} className="rounded" />
                Activo
              </label>
              <button className="boton-primario w-full">Guardar cambios</button>
            </form>
          </Tarjeta>
        </div>
      </div>
    </>
  );
}
