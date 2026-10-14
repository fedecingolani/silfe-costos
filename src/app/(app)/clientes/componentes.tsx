import Link from "next/link";
import { ETIQUETAS_TIPO_INTERACCION, type ClienteSeguimiento, type EstadoSeguimiento } from "@/lib/tipos";
import { Pastilla, BotonEliminar } from "@/components/ui";
import { ESTADOS_SEGUIMIENTO, truncar } from "@/lib/clientes/seguimiento";
import { fecha, fechaHora } from "@/lib/formato";

type Accion = (formData: FormData) => Promise<void>;

/** Pastilla de color con el estado de seguimiento. */
export function PastillaSeguimiento({ estado }: { estado: EstadoSeguimiento }) {
  const { etiqueta, tono } = ESTADOS_SEGUIMIENTO[estado];
  return <Pastilla tono={tono}>{etiqueta}</Pastilla>;
}

/** Último contacto: fecha y tipo, y opcionalmente el resumen recortado. */
export function UltimoContacto({
  seguimiento,
  resumen = false,
}: {
  seguimiento: Pick<ClienteSeguimiento, "ultima_interaccion_fecha" | "ultima_interaccion_tipo" | "ultimo_resumen">;
  resumen?: boolean;
}) {
  if (!seguimiento.ultima_interaccion_fecha) return <span className="text-stone-400">Nunca</span>;
  return (
    <span>
      <span className="whitespace-nowrap">{fechaHora(seguimiento.ultima_interaccion_fecha)}</span>
      {seguimiento.ultima_interaccion_tipo && (
        <span className="text-stone-400"> · {ETIQUETAS_TIPO_INTERACCION[seguimiento.ultima_interaccion_tipo]}</span>
      )}
      {resumen && seguimiento.ultimo_resumen && (
        <span className="block text-xs text-stone-500" title={seguimiento.ultimo_resumen}>
          {truncar(seguimiento.ultimo_resumen, 80)}
        </span>
      )}
    </span>
  );
}

export function FilaCliente({
  cliente,
  transporte,
  eliminar,
}: {
  cliente: ClienteSeguimiento;
  transporte: string | null;
  eliminar: Accion;
}) {
  return (
    <tr>
      <td>
        <Link
          href={`/clientes/${cliente.cliente_id}`}
          className="font-medium text-stone-900 hover:text-marca-700 hover:underline"
        >
          {cliente.razon_social}
        </Link>
        {cliente.codigo_legado !== null && (
          <span className="ml-1.5 font-mono text-xs text-stone-400">#{cliente.codigo_legado}</span>
        )}
      </td>
      <td className="text-stone-500">{cliente.cuit ?? "—"}</td>
      <td className="text-stone-500">{cliente.zona ?? "—"}</td>
      <td className="text-stone-500">{cliente.localidad ?? "—"}</td>
      <td className="text-stone-500">{cliente.telefono ?? "—"}</td>
      <td className="text-stone-500">{transporte ?? "—"}</td>
      <td className="text-stone-500">
        <UltimoContacto seguimiento={cliente} />
      </td>
      <td className="whitespace-nowrap">
        {cliente.proximo_contacto && <span className="mr-1.5 text-stone-500">{fecha(cliente.proximo_contacto)}</span>}
        <PastillaSeguimiento estado={cliente.estado_seguimiento} />
      </td>
      <td>
        {cliente.activo ? <Pastilla tono="verde">Activo</Pastilla> : <Pastilla>Inactivo</Pastilla>}
      </td>
      <td className="whitespace-nowrap text-right">
        <Link
          href={`/clientes/${cliente.cliente_id}?editar=1`}
          className="mr-2 text-xs text-marca-700 hover:underline"
        >
          Editar
        </Link>
        <form action={eliminar} className="inline">
          <input type="hidden" name="id" value={cliente.cliente_id} />
          <BotonEliminar />
        </form>
      </td>
    </tr>
  );
}
