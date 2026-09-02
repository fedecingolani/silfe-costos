"use client";

type Accion = (formData: FormData) => Promise<void>;

export function CampoNombreContacto({
  formId,
  id,
  clienteId,
  nombre,
  accion,
}: {
  formId: string;
  id: string;
  clienteId: string;
  nombre: string;
  accion: Accion;
}) {
  return (
    <form id={formId} action={accion} className="flex h-7 items-center">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="cliente_id" value={clienteId} />
      <input
        name="nombre"
        defaultValue={nombre}
        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
        className="campo mt-0 w-full px-1.5 py-1 text-sm"
      />
    </form>
  );
}

export function CampoCargoContacto({ formId, cargo }: { formId: string; cargo: string | null }) {
  return (
    <input
      name="cargo"
      form={formId}
      defaultValue={cargo ?? ""}
      onBlur={(e) => e.currentTarget.form?.requestSubmit()}
      className="campo mt-0 w-full px-1.5 py-1 text-sm"
    />
  );
}

export function CampoTelefonoContacto({ formId, telefono }: { formId: string; telefono: string | null }) {
  return (
    <input
      name="telefono"
      form={formId}
      defaultValue={telefono ?? ""}
      onBlur={(e) => e.currentTarget.form?.requestSubmit()}
      className="campo mt-0 w-full px-1.5 py-1 text-sm"
    />
  );
}

export function FormularioContacto({ clienteId, accion }: { clienteId: string; accion: Accion }) {
  return (
    <form action={accion} className="grid gap-3 border-t border-stone-200 bg-stone-50 p-4 sm:grid-cols-12">
      <input type="hidden" name="cliente_id" value={clienteId} />

      <div className="sm:col-span-4">
        <label className="etiqueta">Nombre *</label>
        <input name="nombre" required className="campo" />
      </div>

      <div className="sm:col-span-3">
        <label className="etiqueta">Cargo</label>
        <input name="cargo" className="campo" />
      </div>

      <div className="sm:col-span-3">
        <label className="etiqueta">Teléfono</label>
        <input name="telefono" className="campo" />
      </div>

      <div className="sm:col-span-1">
        <label className="etiqueta">Orden</label>
        <input name="orden" defaultValue="0" className="campo" />
      </div>

      <div className="flex items-end sm:col-span-1">
        <button className="boton-primario w-full">Agregar</button>
      </div>
    </form>
  );
}
