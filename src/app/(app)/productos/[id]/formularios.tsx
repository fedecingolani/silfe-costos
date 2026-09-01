"use client";

import { useState } from "react";
import type { CategoriaManoObra, MateriaPrimaCosto, Proceso, ProductoCosto } from "@/lib/tipos";
import { pesos } from "@/lib/formato";

type Accion = (formData: FormData) => Promise<void>;

export function FormularioComponente({
  productoId,
  permiteSubgrupos,
  materias,
  subgrupos,
  accion,
}: {
  productoId: string;
  permiteSubgrupos: boolean;
  materias: MateriaPrimaCosto[];
  subgrupos: ProductoCosto[];
  accion: Accion;
}) {
  const [tipo, setTipo] = useState<"MATERIA_PRIMA" | "SUBGRUPO">("MATERIA_PRIMA");
  const esSubgrupo = permiteSubgrupos && tipo === "SUBGRUPO";

  return (
    <form action={accion} className="grid gap-3 border-t border-stone-200 bg-stone-50 p-4 sm:grid-cols-12">
      <input type="hidden" name="producto_id" value={productoId} />

      {permiteSubgrupos && (
        <div className="sm:col-span-3">
          <label className="etiqueta">Tipo</label>
          <select
            name="tipo"
            className="campo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as typeof tipo)}
          >
            <option value="MATERIA_PRIMA">Materia prima</option>
            <option value="SUBGRUPO">Subgrupo</option>
          </select>
        </div>
      )}
      {!permiteSubgrupos && <input type="hidden" name="tipo" value="MATERIA_PRIMA" />}

      <div className={permiteSubgrupos ? "sm:col-span-4" : "sm:col-span-5"}>
        <label className="etiqueta">{esSubgrupo ? "Subgrupo" : "Materia prima"}</label>
        <select name="referencia_id" required className="campo" key={tipo}>
          <option value="">Elegir…</option>
          {esSubgrupo
            ? subgrupos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.codigo} · {s.nombre} ({pesos(s.costo_total)})
                </option>
              ))
            : materias.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.codigo} · {m.nombre} ({pesos(m.costo_unitario_uso_con_merma, true)}/{m.unidad_uso})
                </option>
              ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="etiqueta">Cantidad *</label>
        <input name="cantidad" required defaultValue="1" className="campo" />
      </div>

      <div className="sm:col-span-2">
        <label className="etiqueta">Merma de uso %</label>
        <input name="merma_pct" defaultValue="0" className="campo" />
      </div>

      <div className="sm:col-span-1">
        <label className="etiqueta">Orden</label>
        <input name="orden" defaultValue="0" className="campo" />
      </div>

      <div className="sm:col-span-9">
        <label className="etiqueta">Notas</label>
        <input name="notas" className="campo" placeholder="Ej: 2 tiras de 1,60 m" />
      </div>
      <div className="flex items-end sm:col-span-3">
        <button className="boton-primario w-full">Agregar a la estructura</button>
      </div>
    </form>
  );
}

export function FormularioProceso({
  productoId,
  procesos,
  categorias,
  accion,
}: {
  productoId: string;
  procesos: Proceso[];
  categorias: CategoriaManoObra[];
  accion: Accion;
}) {
  const [modo, setModo] = useState<"TIEMPO" | "FIJO">("TIEMPO");

  return (
    <form action={accion} className="grid gap-3 border-t border-stone-200 bg-stone-50 p-4 sm:grid-cols-12">
      <input type="hidden" name="producto_id" value={productoId} />

      <div className="sm:col-span-3">
        <label className="etiqueta">Proceso *</label>
        <select name="proceso_id" required className="campo">
          <option value="">Elegir…</option>
          {procesos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.codigo} · {p.nombre}
            </option>
          ))}
        </select>
      </div>

      <div className="sm:col-span-2">
        <label className="etiqueta">Modo</label>
        <select
          name="modo"
          className="campo"
          value={modo}
          onChange={(e) => setModo(e.target.value as typeof modo)}
        >
          <option value="TIEMPO">Tiempo × tarifa</option>
          <option value="FIJO">Monto fijo</option>
        </select>
      </div>

      {modo === "TIEMPO" ? (
        <>
          <div className="sm:col-span-2">
            <label className="etiqueta">Minutos *</label>
            <input name="minutos" required className="campo" />
          </div>
          <div className="sm:col-span-3">
            <label className="etiqueta">Categoría *</label>
            <select name="categoria_mano_obra_id" required className="campo">
              <option value="">Elegir…</option>
              {categorias.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre} ({pesos(c.costo_hora * (1 + c.cargas_sociales_pct / 100))}/h)
                </option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <div className="sm:col-span-5">
          <label className="etiqueta">Costo fijo *</label>
          <input name="costo_fijo" required className="campo" placeholder="Monto por ciclo" />
        </div>
      )}

      <div className="sm:col-span-1">
        <label className="etiqueta">Orden</label>
        <input name="orden" defaultValue="0" className="campo" />
      </div>

      <div className="sm:col-span-1">
        <label className="etiqueta">U./ciclo</label>
        <input name="cantidad_por_ciclo" defaultValue="1" className="campo" />
      </div>

      <div className="sm:col-span-9">
        <label className="etiqueta">Notas</label>
        <input name="notas" className="campo" placeholder="Ej: se pintan 4 piezas por tanda" />
      </div>
      <div className="flex items-end sm:col-span-3">
        <button className="boton-primario w-full">Agregar proceso</button>
      </div>

      <p className="text-xs text-stone-500 sm:col-span-12">
        <strong>Unidades por ciclo</strong>: si el proceso rinde para varias unidades a la vez (una tanda de
        pintura, un corte de varias piezas), el costo se divide entre esa cantidad.
      </p>
    </form>
  );
}
