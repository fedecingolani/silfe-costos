import Link from "next/link";
import { cuentasDelMedio, tipoCuentaDelMedio, type CuentaElegible } from "@/lib/finanzas/medios";
import type { TipoMedioPagoCompra } from "@/lib/tipos";

/**
 * Selector de la caja o la cuenta bancaria de un medio de una orden de pago
 * (sólo las activas del tipo que corresponde). Sin ninguna, enlaza a la
 * pantalla donde se crea.
 */
export function SelectorCuenta({
  cuentas,
  tipo,
  valor,
  onCambiar,
  className = "",
}: {
  cuentas: readonly CuentaElegible[];
  tipo: TipoMedioPagoCompra;
  valor: string;
  onCambiar: (valor: string) => void;
  className?: string;
}) {
  const esCaja = tipoCuentaDelMedio(tipo) === "caja";
  const posibles = cuentasDelMedio(cuentas, tipo);
  return (
    <label className={`block ${className}`}>
      <span className="etiqueta">{esCaja ? "Caja" : "Cuenta bancaria"} (para confirmar)</span>
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
