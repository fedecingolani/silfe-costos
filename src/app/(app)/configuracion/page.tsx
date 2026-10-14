import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { Encabezado, Tarjeta } from "@/components/ui";
import { aNumero, aTexto } from "@/lib/formato";
import type { ParametroCosteo } from "@/lib/tipos";

export const dynamic = "force-dynamic";

async function guardar(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { error } = await supabase
    .from("parametro_costeo")
    .update({
      moneda: String(formData.get("moneda") ?? "ARS").trim(),
      gastos_generales_pct: aNumero(formData.get("gastos_generales_pct"), 0),
      margen_pct: aNumero(formData.get("margen_pct"), 0),
      lista_texto_destacado: aTexto(formData.get("lista_texto_destacado")),
      lista_contacto: aTexto(formData.get("lista_contacto")),
    })
    .eq("id", true);
  if (error) throw new Error(`No se pudieron guardar los parámetros: ${error.message}`);
  revalidatePath("/", "layout");
}

export default async function ConfiguracionPage() {
  const supabase = await createClient();
  const { data } = await supabase.from("parametro_costeo").select("*").single();
  const p = data as ParametroCosteo | null;

  return (
    <>
      <Encabezado
        titulo="Parámetros de costeo"
        descripcion="Se aplican a todos los productos: los gastos generales se suman al costo directo y el margen se aplica sobre el costo total."
      />

      <div className="grid gap-6 lg:grid-cols-[24rem_1fr] lg:items-start">
        <Tarjeta titulo="Parámetros">
          <form action={guardar} className="space-y-3 p-4">
            <div>
              <label className="etiqueta">Moneda</label>
              <input name="moneda" defaultValue={p?.moneda ?? "ARS"} className="campo" />
            </div>
            <div>
              <label className="etiqueta">Gastos generales %</label>
              <input
                name="gastos_generales_pct"
                defaultValue={p?.gastos_generales_pct ?? 0}
                className="campo"
              />
              <p className="mt-1 text-xs text-stone-500">
                Alquiler, energía, supervisión, amortizaciones. Se calcula sobre materiales + mano de obra.
              </p>
            </div>
            <div>
              <label className="etiqueta">Margen de ganancia %</label>
              <input name="margen_pct" defaultValue={p?.margen_pct ?? 0} className="campo" />
              <p className="mt-1 text-xs text-stone-500">
                Sólo se usa para calcular el precio sugerido; no afecta el costo.
              </p>
            </div>
            <div className="border-t border-stone-200 pt-3">
              <p className="text-sm font-medium text-stone-800">Pie de la lista de precios</p>
              <p className="mt-1 text-xs text-stone-500">
                Se imprime al final del PDF de cada lista. Si lo dejás vacío, no se imprime.
              </p>
            </div>
            <div>
              <label className="etiqueta">Texto destacado</label>
              <input
                name="lista_texto_destacado"
                defaultValue={p?.lista_texto_destacado ?? ""}
                placeholder="SIL – FE 30 AÑOS"
                className="campo"
              />
              <p className="mt-1 text-xs text-stone-500">Va grande y centrado, debajo de los precios.</p>
            </div>
            <div>
              <label className="etiqueta">Contacto</label>
              <textarea
                name="lista_contacto"
                rows={4}
                defaultValue={p?.lista_contacto ?? ""}
                className="campo"
              />
              <p className="mt-1 text-xs text-stone-500">
                Teléfonos, correo, dirección. Cada renglón se imprime en una línea.
              </p>
            </div>
            <button className="boton-primario">Guardar parámetros</button>
          </form>
        </Tarjeta>

        <Tarjeta titulo="Cómo se arma el costo">
          <div className="space-y-3 p-4 text-sm text-stone-600">
            <p className="font-mono text-xs leading-6 text-stone-700">
              costo materia prima por unidad de uso = precio de compra ÷ factor de conversión ÷ (1 − merma%)
              <br />
              costo de un componente = cantidad ÷ (1 − merma de uso%) × costo unitario
              <br />
              costo de un subgrupo = Σ sus materias primas + Σ sus procesos
              <br />
              costo de un proceso (tiempo) = minutos ÷ 60 × costo/hora × (1 + cargas%) ÷ unidades por ciclo
              <br />
              costo de un proceso (fijo) = costo fijo ÷ unidades por ciclo
              <br />
              costo directo = materiales (propios + de subgrupos) + mano de obra (propia + de subgrupos)
              <br />
              costo total = costo directo × (1 + gastos generales%)
              <br />
              precio sugerido = costo total × (1 + margen%)
            </p>
            <p className="text-xs text-stone-500">
              La estructura soporta dos niveles: un producto terminado lleva subgrupos y materias primas sueltas;
              un subgrupo sólo lleva materias primas.
            </p>
          </div>
        </Tarjeta>
      </div>
    </>
  );
}
