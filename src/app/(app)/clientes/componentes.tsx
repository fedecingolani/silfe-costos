import Link from "next/link";
import type { Cliente, Zona } from "@/lib/tipos";
import { Pastilla, BotonEliminar } from "@/components/ui";

type Accion = (formData: FormData) => Promise<void>;

export function FormularioCliente({
  accion,
  cliente,
  zonas,
  cancelarHref,
}: {
  accion: Accion;
  cliente?: Cliente;
  zonas: Zona[];
  cancelarHref?: string;
}) {
  return (
    <form action={accion} className="space-y-3 p-4">
      {cliente && <input type="hidden" name="id" value={cliente.id} />}
      <div>
        <label className="etiqueta">Razón social *</label>
        <input
          name="razon_social"
          required
          defaultValue={cliente?.razon_social ?? ""}
          className="campo"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">CUIT</label>
          <input name="cuit" defaultValue={cliente?.cuit ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Código legado</label>
          <input name="codigo_legado" defaultValue={cliente?.codigo_legado ?? ""} className="campo" />
        </div>
      </div>
      <div>
        <label className="etiqueta">Dirección</label>
        <input name="direccion" defaultValue={cliente?.direccion ?? ""} className="campo" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">Localidad</label>
          <input name="localidad" defaultValue={cliente?.localidad ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Provincia</label>
          <input name="provincia" defaultValue={cliente?.provincia ?? ""} className="campo" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">Código postal</label>
          <input name="codigo_postal" defaultValue={cliente?.codigo_postal ?? ""} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Teléfono</label>
          <input name="telefono" defaultValue={cliente?.telefono ?? ""} className="campo" />
        </div>
      </div>
      <div>
        <label className="etiqueta">Zona</label>
        <select name="zona_id" defaultValue={cliente?.zona_id ?? ""} className="campo">
          <option value="">—</option>
          {zonas.map((z) => (
            <option key={z.id} value={z.id}>
              {z.nombre}
            </option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm text-stone-600">
        <input type="checkbox" name="activo" defaultChecked={cliente?.activo ?? true} className="rounded" />
        Activo
      </label>
      <div className="flex gap-2 pt-1">
        <button type="submit" className="boton-primario">
          {cliente ? "Guardar cambios" : "Agregar cliente"}
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

export function FilaCliente({
  cliente,
  zona,
  eliminar,
}: {
  cliente: Cliente;
  zona: string | null;
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
      </td>
      <td className="text-stone-500">{cliente.cuit ?? "—"}</td>
      <td className="text-stone-500">{zona ?? "—"}</td>
      <td className="text-stone-500">{cliente.localidad ?? "—"}</td>
      <td className="text-stone-500">{cliente.telefono ?? "—"}</td>
      <td>
        {cliente.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}
      </td>
      <td className="whitespace-nowrap text-right">
        <Link
          href={`/clientes?editar=${cliente.id}`}
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
