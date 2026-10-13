import type { UnidadMedida } from "@/lib/tipos";

/** Campos de venta del producto (IVA y presentación), compartidos por el alta y la edición. */
export function CamposVenta({
  unidades,
  alicuotaIva = 21,
  unidadVentaId = null,
  factorVenta = 1,
}: {
  unidades: UnidadMedida[];
  alicuotaIva?: number;
  unidadVentaId?: string | null;
  factorVenta?: number;
}) {
  return (
    <fieldset className="space-y-3 rounded-lg border border-stone-200 p-3">
      <legend className="px-1 text-xs font-medium uppercase tracking-wide text-stone-500">Datos de venta</legend>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="etiqueta">IVA %</label>
          <input name="alicuota_iva" required defaultValue={alicuotaIva} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Presentación</label>
          <select name="unidad_venta_id" defaultValue={unidadVentaId ?? ""} className="campo">
            <option value="">Igual a la unidad</option>
            {unidades.map((u) => (
              <option key={u.id} value={u.id}>
                {u.codigo} · {u.nombre}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Factor</label>
          <input name="factor_venta" required defaultValue={factorVenta} className="campo" />
        </div>
      </div>
      <p className="text-xs text-stone-500">
        <strong>Factor</strong>: cuántas unidades de costeo entran en una presentación de venta. Si se costea y se
        vende por docena es 1; si se costea por unidad y se vende por docena es 12. El precio por presentación es el
        precio sugerido × factor, sin IVA.
      </p>
    </fieldset>
  );
}
