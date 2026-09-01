import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, Kpi, Pastilla } from "@/components/ui";
import { pesos, porcentaje, minutosAHoras } from "@/lib/formato";
import type { MateriaPrimaCosto, ParametroCosteo, ProductoCosto, UsoMateriaPrima } from "@/lib/tipos";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const supabase = await createClient();

  const [{ data: productosData }, { data: materiasData }, { data: usosData }, { data: paramData }] =
    await Promise.all([
      supabase.from("v_producto_costo").select("*").order("codigo"),
      supabase.from("v_materia_prima_costo").select("*"),
      supabase.from("v_uso_materia_prima").select("*"),
      supabase.from("parametro_costeo").select("*").maybeSingle(),
    ]);

  const productos = (productosData ?? []) as ProductoCosto[];
  const materias = (materiasData ?? []) as MateriaPrimaCosto[];
  const usos = (usosData ?? []) as UsoMateriaPrima[];
  const parametros = paramData as ParametroCosteo | null;

  const terminados = productos.filter((p) => p.tipo === "TERMINADO");
  const subgrupos = productos.filter((p) => p.tipo === "SUBGRUPO");
  const sinPrecio = materias.filter((m) => m.precio_compra === null);

  const costoPromedio =
    terminados.length > 0 ? terminados.reduce((a, p) => a + p.costo_total, 0) / terminados.length : 0;

  // Impacto de cada materia prima sobre el costo de los productos terminados.
  const idsTerminados = new Set(terminados.map((p) => p.id));
  const impacto = new Map<string, { nombre: string; codigo: string; costo: number; productos: Set<string> }>();
  for (const u of usos) {
    if (!idsTerminados.has(u.producto_id)) continue;
    const mp = materias.find((m) => m.id === u.materia_prima_id);
    if (!mp) continue;
    const actual = impacto.get(u.materia_prima_id) ?? {
      nombre: mp.nombre,
      codigo: mp.codigo,
      costo: 0,
      productos: new Set<string>(),
    };
    actual.costo += u.costo;
    actual.productos.add(u.producto_id);
    impacto.set(u.materia_prima_id, actual);
  }
  const ranking = [...impacto.entries()]
    .map(([id, v]) => ({ id, ...v, cantidadProductos: v.productos.size }))
    .sort((a, b) => b.costo - a.costo)
    .slice(0, 8);

  return (
    <>
      <Encabezado
        titulo="Panel de costos"
        descripcion="Estado general del costeo. Los costos se recalculan solos cada vez que cambia un precio, un tiempo de proceso o una estructura."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          etiqueta="Productos terminados"
          valor={String(terminados.length)}
          detalle={`${subgrupos.length} subgrupos`}
        />
        <Kpi
          etiqueta="Materias primas"
          valor={String(materias.length)}
          detalle={sinPrecio.length > 0 ? `${sinPrecio.length} sin precio` : "todas con precio"}
        />
        <Kpi etiqueta="Costo promedio por producto" valor={pesos(costoPromedio)} />
        <Kpi
          etiqueta="Parámetros"
          valor={`${porcentaje(parametros?.gastos_generales_pct)} / ${porcentaje(parametros?.margen_pct)}`}
          detalle="gastos generales / margen"
        />
      </div>

      {sinPrecio.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{sinPrecio.length} materias primas sin precio.</strong> Los productos que las usan quedan
          subvaluados:{" "}
          {sinPrecio.slice(0, 5).map((m, i) => (
            <span key={m.id}>
              {i > 0 && ", "}
              <Link href={`/materias-primas/${m.id}`} className="underline">
                {m.nombre}
              </Link>
            </span>
          ))}
          {sinPrecio.length > 5 && ` y ${sinPrecio.length - 5} más`}.
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem] xl:items-start">
        <Tarjeta
          titulo="Costo de productos terminados"
          acciones={
            <Link href="/productos" className="text-xs text-marca-700 hover:underline">
              Ver todos
            </Link>
          }
        >
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Materiales</th>
                  <th className="num">Mano de obra</th>
                  <th className="num">Tiempo</th>
                  <th className="num">Costo total</th>
                  <th className="num">Precio sugerido</th>
                </tr>
              </thead>
              <tbody>
                {terminados.length === 0 && (
                  <Vacio mensaje="Todavía no hay productos terminados cargados." colSpan={6} />
                )}
                {terminados.map((p) => {
                  const pctMat = p.costo_total > 0 ? (p.costo_materiales / p.costo_total) * 100 : 0;
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link
                          href={`/productos/${p.id}`}
                          className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                        >
                          {p.nombre}
                        </Link>
                        <div className="text-xs text-stone-400">{p.codigo}</div>
                      </td>
                      <td className="num">
                        {pesos(p.costo_materiales)}
                        <div className="text-xs text-stone-400">{porcentaje(pctMat)}</div>
                      </td>
                      <td className="num">{pesos(p.costo_mano_obra)}</td>
                      <td className="num text-stone-500">{minutosAHoras(p.minutos_totales)}</td>
                      <td className="num font-semibold">{pesos(p.costo_total)}</td>
                      <td className="num text-marca-800">{pesos(p.precio_sugerido)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Tarjeta>

        <Tarjeta
          titulo="Materias primas de mayor impacto"
          descripcion="Suma del costo que aporta cada material a los productos terminados."
        >
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Material</th>
                  <th className="num">Productos</th>
                  <th className="num">Costo aportado</th>
                </tr>
              </thead>
              <tbody>
                {ranking.length === 0 && <Vacio mensaje="Sin datos todavía." colSpan={3} />}
                {ranking.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link
                        href={`/materias-primas/${r.id}`}
                        className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
                      >
                        {r.nombre}
                      </Link>
                      <div className="text-xs text-stone-400">{r.codigo}</div>
                    </td>
                    <td className="num text-stone-500">{r.cantidadProductos}</td>
                    <td className="num font-medium">{pesos(r.costo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      </div>

      {subgrupos.length > 0 && (
        <div className="mt-6">
          <Tarjeta titulo="Subgrupos" descripcion="Conjuntos intermedios reutilizables entre productos.">
            <div className="flex flex-wrap gap-3 p-4">
              {subgrupos.map((s) => (
                <Link
                  key={s.id}
                  href={`/productos/${s.id}`}
                  className="rounded-lg border border-stone-200 px-3 py-2 transition hover:border-marca-400 hover:bg-marca-50"
                >
                  <div className="flex items-center gap-2">
                    <Pastilla tono="azul">{s.codigo}</Pastilla>
                    <span className="text-sm font-medium text-stone-900">{s.nombre}</span>
                  </div>
                  <div className="mt-1 text-sm tabular-nums text-stone-600">
                    {pesos(s.costo_directo)}{" "}
                    <span className="text-xs text-stone-400">
                      ({pesos(s.costo_materiales)} mat. + {pesos(s.costo_mano_obra)} m.o.)
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </Tarjeta>
        </div>
      )}
    </>
  );
}
