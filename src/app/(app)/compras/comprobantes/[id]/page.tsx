import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Migas, Pastilla, Tarjeta } from "@/components/ui";
import { fecha, fechaHora, numero, pesos } from "@/lib/formato";
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import { discriminaIva } from "@/lib/compras/comprobantes/letra";
import {
  NOMBRES_ESTADO_COMPROBANTE_COMPRA,
  TONO_ESTADO_COMPROBANTE_COMPRA,
  permisosComprobanteCompra,
} from "@/lib/compras/comprobantes/listado";
import { esNotaCompra, puedeTenerNotas, type FacturaAsociable } from "@/lib/compras/comprobantes/nota";
import { NOMBRES_TIPO_COMPROBANTE_COMPRA, numeroComprobanteCompra } from "@/lib/compras/comprobantes/numero";
import type { CondicionIva } from "@/lib/tipos";
import { AnularComprobanteCompra } from "../AnularComprobanteCompra";
import {
  cargarArticulos,
  cargarComprobanteCompra,
  cargarContextoEditorCompra,
  cargarFacturaAsociada,
  cargarFacturasAsociables,
  cargarNotasAsociadas,
  cargarRemitosDeRenglones,
} from "../datos";
import { EditorComprobanteCompra } from "../EditorComprobanteCompra";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NOMBRES_PERCEPCION = { iva: "IVA", iibb: "Ingresos brutos", otro: "Otro" } as const;

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-stone-900">{children}</dd>
    </div>
  );
}

function Linea({ etiqueta, valor }: { etiqueta: string; valor: number }) {
  return (
    <div className="flex justify-between">
      <dt className="text-stone-500">{etiqueta}</dt>
      <dd className="tabular-nums">{pesos(valor)}</dd>
    </div>
  );
}

export default async function ComprobanteCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();

  const cargado = await cargarComprobanteCompra(supabase, id);
  if (typeof cargado === "string") {
    return <p className="text-sm text-red-700">Error al cargar el comprobante: {cargado}</p>;
  }
  if (!cargado) notFound();
  const { comprobante: c, items, percepciones } = cargado;
  const permisos = permisosComprobanteCompra(c.estado);

  const titulo = numeroComprobanteCompra(c);
  const pastilla = (
    <Pastilla tono={TONO_ESTADO_COMPROBANTE_COMPRA[c.estado]}>{NOMBRES_ESTADO_COMPROBANTE_COMPRA[c.estado]}</Pastilla>
  );
  const migas = <Migas items={[{ href: "/compras/comprobantes", texto: "Comprobantes de compra" }, { texto: titulo }]} />;

  // ----- Borrador: se edita ------------------------------------------------------

  if (permisos.puedeEditar) {
    // La asociada se lee aparte: puede quedar fuera de la lista (tiene un tope).
    // Si falla alguna de las dos, el editor se abre igual y lo avisa.
    // Si falla la lectura de los remitos, los renglones lo dicen sin el número: el vínculo se conserva igual.
    const [contexto, articulos, facturas, asociada, remitos] = await Promise.all([
      cargarContextoEditorCompra(supabase),
      cargarArticulos(supabase, c.proveedor_id),
      esNotaCompra(c.tipo)
        ? cargarFacturasAsociables(supabase, c.proveedor_id, c.letra)
        : Promise.resolve([] as FacturaAsociable[]),
      c.comprobante_asociado_id ? cargarFacturaAsociada(supabase, c.comprobante_asociado_id) : Promise.resolve(undefined),
      cargarRemitosDeRenglones(supabase, items),
    ]);
    if (typeof contexto === "string" || typeof articulos === "string") {
      const error = [contexto, articulos].find((v) => typeof v === "string");
      return <p className="text-sm text-red-700">Error al cargar los datos del comprobante: {error as string}</p>;
    }
    return (
      <>
        {migas}
        <Encabezado
          titulo={titulo}
          descripcion="Borrador: se puede editar, confirmar o borrar. Al confirmarlo ya no se modifica."
          acciones={pastilla}
        />
        <EditorComprobanteCompra
          guardado={cargado}
          contexto={contexto}
          articulos={articulos}
          facturas={typeof facturas === "string" ? [] : facturas}
          errorFacturas={typeof facturas === "string" ? facturas : null}
          facturaAsociada={typeof asociada === "string" ? undefined : asociada}
          remitos={typeof remitos === "string" ? {} : remitos}
          hoy={hoyArgentina()}
        />
      </>
    );
  }

  // ----- Confirmado o anulado: sólo lectura -------------------------------------

  const materiaIds = [...new Set(items.map((i) => i.materia_prima_id).filter((v): v is string => v !== null))];
  const [{ data: proveedorData }, { data: materiasData, error: errorMaterias }, facturaAsociadaLeida, notas, remitosLeidos] =
    await Promise.all([
      supabase.from("proveedor").select("id, nombre, cuit, condicion_iva").eq("id", c.proveedor_id).maybeSingle(),
      materiaIds.length > 0
        ? supabase.from("materia_prima").select("id, codigo, nombre").in("id", materiaIds)
        : Promise.resolve({ data: [], error: null }),
      c.comprobante_asociado_id ? cargarFacturaAsociada(supabase, c.comprobante_asociado_id) : Promise.resolve(null),
      c.tipo === "factura" ? cargarNotasAsociadas(supabase, c.id) : Promise.resolve([]),
      cargarRemitosDeRenglones(supabase, items),
    ]);
  if (errorMaterias) {
    return <p className="text-sm text-red-700">Error al cargar las materias primas: {errorMaterias.message}</p>;
  }
  if (typeof notas === "string") return <p className="text-sm text-red-700">{notas}</p>;
  // Si no se pudo leer, queda el enlace a la factura sin su número.
  const facturaAsociada = typeof facturaAsociadaLeida === "string" ? null : facturaAsociadaLeida;
  // Igual con los remitos de los renglones: sin número, el renglón dice que viene de un remito.
  const remitos = typeof remitosLeidos === "string" ? {} : remitosLeidos;
  const proveedor = proveedorData as { id: string; nombre: string; cuit: string | null; condicion_iva: CondicionIva | null } | null;
  const materias = new Map(
    ((materiasData ?? []) as { id: string; codigo: string; nombre: string }[]).map((m) => [m.id, m]),
  );
  const conIva = discriminaIva(c.letra);
  const ivaPorAlicuota = new Map<number, number>();
  for (const i of items) {
    if (conIva && i.alicuota_iva !== null && !i.exento) {
      ivaPorAlicuota.set(i.alicuota_iva, (ivaPorAlicuota.get(i.alicuota_iva) ?? 0) + i.iva);
    }
  }
  const descripcion =
    c.estado === "anulado"
      ? `Anulado el ${fechaHora(c.anulado_en)}: conserva sus datos y ya no cuenta.`
      : `Confirmado el ${fechaHora(c.confirmado_en)}: ya no se modifica. Si está mal, se anula y se vuelve a cargar.`;

  return (
    <>
      {migas}
      <Encabezado titulo={titulo} descripcion={descripcion} acciones={pastilla} />

      {(permisos.puedeAnular || puedeTenerNotas(c)) && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {puedeTenerNotas(c) && (
            <>
              <Link
                href={`/compras/comprobantes/nuevo?desde=${c.id}&tipo=nota_credito`}
                className="boton-secundario"
                title="Nota asociada a esta factura, con sus renglones y precios para ajustar."
              >
                Nota de crédito
              </Link>
              <Link
                href={`/compras/comprobantes/nuevo?desde=${c.id}&tipo=nota_debito`}
                className="boton-secundario"
                title="Nota asociada a esta factura, con sus renglones y precios para ajustar."
              >
                Nota de débito
              </Link>
            </>
          )}
          {permisos.puedeAnular && <AnularComprobanteCompra id={c.id} />}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Comprobante">
          <dl className="grid grid-cols-2 gap-3 p-4">
            <Dato etiqueta="Tipo">
              {NOMBRES_TIPO_COMPROBANTE_COMPRA[c.tipo]} {c.letra}
            </Dato>
            <Dato etiqueta="Número">{titulo}</Dato>
            <Dato etiqueta="Fecha">{fecha(c.fecha)}</Dato>
            <Dato etiqueta="Vencimiento">{c.fecha_vencimiento ? fecha(c.fecha_vencimiento) : "—"}</Dato>
            <Dato etiqueta="Confirmado">{fechaHora(c.confirmado_en)}</Dato>
            {c.anulado_en && <Dato etiqueta="Anulado">{fechaHora(c.anulado_en)}</Dato>}
            {c.comprobante_asociado_id && (
              <div className="col-span-2">
                <Dato etiqueta="Factura asociada">
                  <Link href={`/compras/comprobantes/${c.comprobante_asociado_id}`} className="text-marca-700 hover:underline">
                    {facturaAsociada ? numeroComprobanteCompra(facturaAsociada) : "Ver factura"}
                  </Link>
                  {facturaAsociada && facturaAsociada.estado !== "confirmado" && (
                    <span className="text-stone-500"> ({NOMBRES_ESTADO_COMPROBANTE_COMPRA[facturaAsociada.estado].toLowerCase()})</span>
                  )}
                </Dato>
              </div>
            )}
            {c.observaciones && (
              <div className="col-span-2">
                <Dato etiqueta="Observaciones">{c.observaciones}</Dato>
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
                <th className="text-right">Precio</th>
                <th className="text-right">% dto</th>
                <th className="text-right">IVA %</th>
                <th className="text-right">Importe</th>
                {conIva && <th className="text-right">IVA</th>}
              </tr>
            </thead>
            <tbody>
              {items.map((i) => {
                const materia = i.materia_prima_id ? materias.get(i.materia_prima_id) : undefined;
                return (
                  <tr key={i.id}>
                    <td className="tabular-nums">{i.codigo_proveedor ?? "—"}</td>
                    <td className="whitespace-pre-wrap">
                      {i.descripcion}
                      {i.remito_compra_item_id && (
                        <p className="text-xs">
                          {remitos[i.remito_compra_item_id] ? (
                            <Link
                              href={`/compras/remitos/${remitos[i.remito_compra_item_id].remitoId}`}
                              className="text-marca-700 hover:underline"
                            >
                              Del remito {remitos[i.remito_compra_item_id].numero}
                            </Link>
                          ) : (
                            <span className="text-stone-500">De un remito de compra</span>
                          )}
                        </p>
                      )}
                    </td>
                    <td>
                      {materia ? `${materia.codigo} — ${materia.nombre}` : i.proveedor_articulo_id ? "—" : "Renglón libre"}
                    </td>
                    <td className="text-right tabular-nums">
                      {numero(i.cantidad, 4)} {i.unidad ?? ""}
                    </td>
                    <td className="text-right tabular-nums">{numero(i.precio_unitario, 4)}</td>
                    <td className="text-right tabular-nums">{numero(i.descuento_pct, 2)}</td>
                    <td className="text-right tabular-nums">
                      {i.exento ? "Exento" : i.alicuota_iva !== null ? `${numero(i.alicuota_iva, 1)}%` : "No grav."}
                    </td>
                    <td className="text-right tabular-nums">{pesos(i.importe)}</td>
                    {conIva && <td className="text-right tabular-nums">{pesos(i.iva)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-stone-200 p-4 text-sm">
          {conIva && <Linea etiqueta="Neto gravado" valor={c.neto_gravado} />}
          {[...ivaPorAlicuota.entries()]
            .sort(([a], [b]) => a - b)
            .map(([alicuota, iva]) => (
              <Linea key={alicuota} etiqueta={`IVA ${numero(alicuota, 1)}%`} valor={iva} />
            ))}
          <Linea etiqueta="No gravado" valor={c.no_gravado} />
          <Linea etiqueta="Exento" valor={c.exento} />
          {c.percepcion_iva > 0 && <Linea etiqueta="Percepciones de IVA" valor={c.percepcion_iva} />}
          {c.percepcion_iibb > 0 && <Linea etiqueta="Percepciones de IIBB" valor={c.percepcion_iibb} />}
          {c.otros_impuestos > 0 && <Linea etiqueta="Otros impuestos" valor={c.otros_impuestos} />}
          <div className="flex justify-between border-t border-stone-200 pt-1 font-semibold">
            <dt>Total</dt>
            <dd className="tabular-nums">{pesos(c.total)}</dd>
          </div>
        </dl>
      </Tarjeta>

      {notas.length > 0 && (
        <Tarjeta titulo="Notas asociadas" className="mt-4">
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Comprobante</th>
                  <th>Fecha</th>
                  <th>Estado</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {notas.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <Link href={`/compras/comprobantes/${n.id}`} className="text-marca-700 hover:underline">
                        {numeroComprobanteCompra(n)}
                      </Link>
                    </td>
                    <td>{fecha(n.fecha)}</td>
                    <td>
                      <Pastilla tono={TONO_ESTADO_COMPROBANTE_COMPRA[n.estado]}>
                        {NOMBRES_ESTADO_COMPROBANTE_COMPRA[n.estado]}
                      </Pastilla>
                    </td>
                    <td className="text-right tabular-nums">{pesos(n.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}

      {percepciones.length > 0 && (
        <Tarjeta titulo="Percepciones" className="mt-4">
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Jurisdicción</th>
                  <th>Descripción</th>
                  <th className="text-right">Importe</th>
                </tr>
              </thead>
              <tbody>
                {percepciones.map((p) => (
                  <tr key={p.id}>
                    <td>{NOMBRES_PERCEPCION[p.tipo]}</td>
                    <td>{p.jurisdiccion ?? "—"}</td>
                    <td>{p.descripcion ?? "—"}</td>
                    <td className="text-right tabular-nums">{pesos(p.importe)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      )}
    </>
  );
}
