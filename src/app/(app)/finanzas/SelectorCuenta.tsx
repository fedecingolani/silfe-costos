import Link from "next/link";
import { cuentasDelTipo, type CuentaElegible } from "@/lib/finanzas/medios";
import type { TipoCuentaFondos } from "@/lib/tipos";

/**
 * Selector de una caja o una cuenta bancaria activa: la de un medio de un
 * recibo o de una orden de pago (con tipoCuentaDelMedio), o la del depósito
 * de un cheque. Sin ninguna, enlaza a la pantalla donde se crea. Sin tipo
 * (un medio que no lleva cuenta) no muestra nada.
 */
export function SelectorCuenta({
  cuentas,
  tipoCuenta,
  para,
  valor,
  onCambiar,
  className = "",
}: {
  /** Cuentas activas (se muestran las del tipo). */
  cuentas: readonly CuentaElegible[];
  /** Caja o banco; null: no se muestra. */
  tipoCuenta: TipoCuentaFondos | null;
  /** Cuándo es obligatoria, para la etiqueta ("para emitir"); sin valor: sin aclaración. */
  para?: string | null;
  valor: string;
  onCambiar: (valor: string) => void;
  className?: string;
}) {
  if (!tipoCuenta) return null;
  const esCaja = tipoCuenta === "caja";
  const posibles = cuentasDelTipo(cuentas, tipoCuenta);
  return (
    <label className={`block ${className}`}>
      <span className="etiqueta">
        {esCaja ? "Caja" : "Cuenta bancaria"}
        {para ? ` (${para})` : ""}
      </span>
      <select value={valor} onChange={(e) => onCambiar(e.target.value)} className="campo">
        <option value="">Elegí…</option>
        {posibles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      {posibles.length === 0 && (
        <span className="mt-1 block text-xs text-amber-700">
          No hay {esCaja ? "cajas activas" : "cuentas bancarias activas"}: creá una en{" "}
          <Link href={esCaja ? "/caja" : "/bancos"} className="text-marca-700 hover:underline">
            {esCaja ? "Caja" : "Bancos"}
          </Link>
          .
        </span>
      )}
    </label>
  );
}
