import Link from "next/link";
import type { Cliente } from "@/lib/tipos";
import { Pastilla, BotonEliminar } from "@/components/ui";

type Accion = (formData: FormData) => Promise<void>;

export function FilaCliente({
  cliente,
  zona,
  transporte,
  eliminar,
}: {
  cliente: Cliente;
  zona: string | null;
  transporte: string | null;
  eliminar: Accion;
}) {
  return (
    <tr>
      <td>
        <Link
          href={`/clientes/${cliente.id}`}
          className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
        >
          {cliente.razon_social}
        </Link>
        {cliente.codigo_legado !== null && (
          <span className="ml-1.5 font-mono text-xs text-stone-400">#{cliente.codigo_legado}</span>
        )}
      </td>
      <td className="text-stone-500">{cliente.cuit ?? "—"}</td>
      <td className="text-stone-500">{zona ?? "—"}</td>
      <td className="text-stone-500">{cliente.localidad ?? "—"}</td>
      <td className="text-stone-500">{cliente.telefono ?? "—"}</td>
      <td className="text-stone-500">{transporte ?? "—"}</td>
      <td>
        {cliente.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}
      </td>
      <td className="whitespace-nowrap text-right">
        <Link
          href={`/clientes/${cliente.id}?editar=1`}
          className="mr-2 text-xs text-marca-700 hover:underline"
        >
          Editar
        </Link>
        <form action={eliminar} className="inline">
          <input type="hidden" name="id" value={cliente.id} />
          <BotonEliminar />
        </form>
      </td>
    </tr>
  );
}
