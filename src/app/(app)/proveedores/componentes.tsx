import Link from "next/link";
import type { Proveedor } from "@/lib/tipos";
import { Pastilla, BotonEliminar } from "@/components/ui";

type Accion = (formData: FormData) => Promise<void>;

export function FormularioProveedor({
  accion,
  proveedor,
  cancelarHref,
}: {
  accion: Accion;
  proveedor?: Proveedor;
  cancelarHref?: string;
}) {
  return (
    <form action={accion} className="space-y-3 p-4">
      {proveedor && <input type="hidden" name="id" value={proveedor.id} />}
      <div>
        <label className="etiqueta">Nombre *</label>
        <input name="nombre" required defaultValue={proveedor?.nombre ?? ""} className="campo" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">CUIT</label>
          <input name="cuit" defaultValue={proveedor?.cuit ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Contacto</label>
          <input name="contacto" defaultValue={proveedor?.contacto ?? ""} className="campo" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">Teléfono</label>
          <input name="telefono" defaultValue={proveedor?.telefono ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Email</label>
          <input name="email" type="email" defaultValue={proveedor?.email ?? ""} className="campo" />
        </div>
      </div>
      <div>
        <label className="etiqueta">Notas</label>
        <textarea name="notas" rows={2} defaultValue={proveedor?.notas ?? ""} className="campo" />
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" name="activo" defaultChecked={proveedor?.activo ?? true} className="rounded" />
        Activo
      </label>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="boton-primario">
          {proveedor ? "Guardar cambios" : "Agregar proveedor"}
        </button>
        {cancelarHref && (
          <Link href={cancelarHref} className="boton-secundario">
            Cancelar
          </Link>
        )}
      </div>
    </form>
  );
}

export function FilaProveedor({
  proveedor,
  eliminar,
}: {
  proveedor: Proveedor;
  eliminar: Accion;
}) {
  return (
    <tr>
      <td className="font-medium text-stone-900">{proveedor.nombre}</td>
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
