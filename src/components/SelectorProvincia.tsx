import type { ComponentProps } from "react";
import { esProvincia, PROVINCIAS } from "@/lib/provincias";

/**
 * Desplegable de provincia (opcional). Si el valor guardado no está en la
 * lista (dato anterior a ella), se ofrece como una opción más para que
 * editar otros campos no lo borre.
 */
export function SelectorProvincia({
  guardada,
  ...props
}: Omit<ComponentProps<"select">, "children"> & { guardada: string | null | undefined }) {
  const anterior = guardada && !esProvincia(guardada) ? guardada : null;
  return (
    <select className="campo" {...props}>
      <option value="">—</option>
      {anterior && <option value={anterior}>{anterior} (fuera de la lista)</option>}
      {PROVINCIAS.map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}
