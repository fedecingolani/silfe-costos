import type { ComponentProps } from "react";

/**
 * Desplegable de banco, con los bancos activos (Configuración → Bancos). Si
 * el valor guardado no está entre ellos (un banco desactivado o anterior a
 * la lista), se ofrece como una opción más para que editar otros campos no
 * lo borre. `opcional` agrega la opción vacía.
 */
export function SelectorBanco({
  bancos,
  guardado,
  opcional = false,
  ...props
}: Omit<ComponentProps<"select">, "children"> & {
  bancos: readonly string[];
  guardado: string | null | undefined;
  opcional?: boolean;
}) {
  const anterior = guardado && !bancos.includes(guardado) ? guardado : null;
  return (
    <select className="campo" {...props}>
      <option value="">{opcional ? "—" : "Elegí un banco…"}</option>
      {anterior && <option value={anterior}>{anterior} (inactivo)</option>}
      {bancos.map((b) => (
        <option key={b} value={b}>
          {b}
        </option>
      ))}
    </select>
  );
}
