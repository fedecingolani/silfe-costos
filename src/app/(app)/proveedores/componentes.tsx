import Link from "next/link";
import type { Proveedor } from "@/lib/tipos";
import { Pastilla, BotonEliminar } from "@/components/ui";

type Accion = (formData: FormData) => Promise<void>;

export function FilaProveedor({
  proveedor,
  eliminar,
}: {
  proveedor: Proveedor;
  eliminar: Accion;
}) {
  return (
    <tr>
      <td>
        <Link
          href={`/proveedores/${proveedor.id}`}
          className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
        >
          {proveedor.nombre}
        </Link>
      </td>
      <td className="text-stone-500">{proveedor.cuit ?? "—"}</td>
      <td className="text-stone-500">{proveedor.contacto ?? "—"}</td>
      <td className="text-stone-500">
        <div>{proveedor.telefono ?? "—"}</div>
        {proveedor.email && <div className="text-xs text-stone-400">{proveedor.email}</div>}
      </td>
      <td>
        {proveedor.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}
      </td>
      <td className="whitespace-nowrap text-right">
        <Link
          href={`/proveedores?editar=${proveedor.id}`}
          className="mr-2 text-xs text-marca-700 hover:underline"
        >
          Editar
        </Link>
        <form action={eliminar} className="inline">
          <input type="hidden" name="id" value={proveedor.id} />
          <BotonEliminar />
        </form>
      </td>
    </tr>
  );
}
