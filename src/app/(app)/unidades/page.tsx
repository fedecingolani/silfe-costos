import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta, Vacio, BotonEliminar, Pastilla } from "@/components/ui";
import { Modal } from "@/components/Modal";
import { numero } from "@/lib/formato";
import type { UnidadMedida } from "@/lib/tipos";
import { crearUnidad, eliminarUnidad, crearConversion, eliminarConversion } from "./acciones";

export const dynamic = "force-dynamic";

const MAGNITUDES = ["MASA", "LONGITUD", "SUPERFICIE", "VOLUMEN", "UNIDAD"];

type Conversion = {
  id: string;
  factor: number;
  origen: { codigo: string } | null;
  destino: { codigo: string } | null;
};

export default async function UnidadesPage() {
  const supabase = await createClient();
  const [{ data: unidades }, { data: conversiones }] = await Promise.all([
    supabase.from("unidad_medida").select("*").order("magnitud").order("codigo"),
    supabase
      .from("conversion_unidad")
      .select("id, factor, origen:unidad_origen_id(codigo), destino:unidad_destino_id(codigo)")
      .order("id"),
  ]);

  const lista = (unidades ?? []) as UnidadMedida[];
  const convs = (conversiones ?? []) as unknown as Conversion[];

  return (
    <>
      <Encabezado
        titulo="Unidades de medida"
        descripcion="Unidades del sistema y conversiones genéricas entre unidades de la misma magnitud (kg ↔ g, m ↔ cm)."
        acciones={
          <>
            <Modal boton="+ Agregar unidad" titulo="Nueva unidad">
              <form action={crearUnidad} className="grid grid-cols-3 gap-3">
                <div>
                  <label className="etiqueta">Código *</label>
                  <input name="codigo" required placeholder="kg" className="campo" />
                </div>
                <div>
                  <label className="etiqueta">Nombre *</label>
                  <input name="nombre" required placeholder="Kilogramo" className="campo" />
                </div>
                <div>
                  <label className="etiqueta">Magnitud</label>
                  <select name="magnitud" className="campo" defaultValue="UNIDAD">
                    {MAGNITUDES.map((m) => (
                      <option key={m} value={m}>
                        {m.toLowerCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <button className="boton-primario">Agregar unidad</button>
                </div>
              </form>
            </Modal>
            <Modal boton="+ Agregar conversión" titulo="Nueva conversión">
              <form action={crearConversion} className="grid grid-cols-3 gap-3">
                <div>
                  <label className="etiqueta">1 de…</label>
                  <select name="unidad_origen_id" required className="campo">
                    {lista.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.codigo}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="etiqueta">equivale a</label>
                  <input name="factor" required placeholder="1000" className="campo" />
                </div>
                <div>
                  <label className="etiqueta">de…</label>
                  <select name="unidad_destino_id" required className="campo">
                    {lista.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.codigo}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-3">
                  <button className="boton-primario">Agregar conversión</button>
                </div>
              </form>
            </Modal>
          </>
        }
      />

      <div className="mb-6 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
        <strong>Conversiones que dependen del material</strong> — por ejemplo comprar soga por kg y usarla por
        metro — no se definen acá, sino en cada materia prima con su <em>factor de conversión</em>, porque el
        rendimiento cambia según el grosor y el material.
      </div>

      <div className="space-y-6">
        <Tarjeta titulo={`${lista.length} unidades`}>
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Código</th>
                  <th>Nombre</th>
                  <th>Magnitud</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lista.length === 0 && <Vacio mensaje="Sin unidades cargadas." colSpan={4} />}
                {lista.map((u) => (
                  <tr key={u.id}>
                    <td className="font-mono font-medium text-stone-900">{u.codigo}</td>
                    <td>{u.nombre}</td>
                    <td>
                      <Pastilla>{u.magnitud.toLowerCase()}</Pastilla>
                    </td>
                    <td className="text-right">
                      <form action={eliminarUnidad}>
                        <input type="hidden" name="id" value={u.id} />
                        <BotonEliminar />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>

        <Tarjeta titulo="Conversiones genéricas" descripcion="1 unidad de origen equivale a N de destino.">
          <div className="overflow-x-auto">
            <table className="tabla">
              <thead>
                <tr>
                  <th>Equivalencia</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {convs.length === 0 && <Vacio mensaje="Sin conversiones cargadas." colSpan={2} />}
                {convs.map((c) => (
                  <tr key={c.id}>
                    <td className="font-mono text-stone-700">
                      1 {c.origen?.codigo} = {numero(c.factor, 6)} {c.destino?.codigo}
                    </td>
                    <td className="text-right">
                      <form action={eliminarConversion}>
                        <input type="hidden" name="id" value={c.id} />
                        <BotonEliminar />
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Tarjeta>
      </div>
    </>
  );
}
