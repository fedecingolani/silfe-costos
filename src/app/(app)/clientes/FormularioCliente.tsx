"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { ModalError } from "@/components/ModalError";
import { CONDICIONES_IVA, type Cliente, type Transporte, type Zona } from "@/lib/tipos";
import { validarCbu, validarCuit, validarCvu, type Validacion } from "@/lib/clientes/validaciones";
import type { EstadoFormularioCliente } from "./acciones";

type AccionConEstado = (
  estado: EstadoFormularioCliente,
  formData: FormData,
) => Promise<EstadoFormularioCliente>;

/** Aviso amarillo que no bloquea el guardado. */
export function AvisoCampo({ mensaje }: { mensaje: string | null }) {
  if (!mensaje) return null;
  return <p className="mt-1 text-xs text-amber-700">⚠ {mensaje}</p>;
}

/** Campo de texto que, al salir, avisa (sin bloquear) si el valor no valida. */
function CampoValidado({
  nombre,
  etiqueta,
  valorInicial,
  validar,
  pattern,
  title,
}: {
  nombre: string;
  etiqueta: string;
  valorInicial: string | null | undefined;
  validar: (valor: string) => Validacion;
  pattern?: string;
  title?: string;
}) {
  const [mensaje, setMensaje] = useState(() => validar(valorInicial ?? "").mensaje);
  return (
    <div>
      <label className="etiqueta">{etiqueta}</label>
      <input
        name={nombre}
        defaultValue={valorInicial ?? ""}
        pattern={pattern}
        title={title}
        inputMode={pattern ? "numeric" : undefined}
        onBlur={(e) => setMensaje(validar(e.currentTarget.value).mensaje)}
        className="campo"
      />
      <AvisoCampo mensaje={mensaje} />
    </div>
  );
}

/**
 * Alta y edición de un cliente. `completo` suma los datos bancarios y las
 * observaciones, que sólo se editan desde la ficha.
 */
export function FormularioCliente({
  accion,
  cliente,
  zonas,
  transportes,
  completo = false,
  cancelarHref,
}: {
  accion: AccionConEstado;
  cliente?: Cliente;
  zonas: Zona[];
  transportes: Transporte[];
  completo?: boolean;
  cancelarHref?: string;
}) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  // Los inactivos no se ofrecen, salvo el que ya tiene asignado el cliente.
  const opcionesTransporte = transportes.filter((t) => t.activo || t.id === cliente?.transporte_id);

  return (
    <>
      <form action={accionFormulario} className="space-y-3 p-4">
        {cliente && <input type="hidden" name="id" value={cliente.id} />}
        <div>
          <label className="etiqueta">Razón social *</label>
          <input name="razon_social" required defaultValue={cliente?.razon_social ?? ""} className="campo" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <CampoValidado nombre="cuit" etiqueta="CUIT" valorInicial={cliente?.cuit} validar={validarCuit} />
          <div>
            <label className="etiqueta">Código legado</label>
            <input name="codigo_legado" defaultValue={cliente?.codigo_legado ?? ""} className="campo" />
          </div>
        </div>
        <div>
          <label className="etiqueta">Condición frente al IVA</label>
          <select name="condicion_iva" defaultValue={cliente?.condicion_iva ?? ""} className="campo">
            <option value="">—</option>
            {CONDICIONES_IVA.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="etiqueta">Domicilio fiscal</label>
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
        <div className="grid grid-cols-2 gap-3">
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
          <div>
            <label className="etiqueta">Transporte habitual</label>
            <select name="transporte_id" defaultValue={cliente?.transporte_id ?? ""} className="campo">
              <option value="">—</option>
              {opcionesTransporte.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activo ? "" : " (inactivo)"}
                </option>
              ))}
            </select>
          </div>
        </div>

        {completo && (
          <>
            <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Datos bancarios</p>
              <div className="mt-2 space-y-3">
                <CampoValidado
                  nombre="cbu"
                  etiqueta="CBU"
                  valorInicial={cliente?.cbu}
                  validar={validarCbu}
                  pattern="[0-9]{22}"
                  title="22 dígitos, sin espacios"
                />
                <CampoValidado
                  nombre="cvu"
                  etiqueta="CVU"
                  valorInicial={cliente?.cvu}
                  validar={validarCvu}
                  pattern="[0-9]{22}"
                  title="22 dígitos, sin espacios"
                />
                <div>
                  <label className="etiqueta">Alias</label>
                  <input
                    name="alias_bancario"
                    defaultValue={cliente?.alias_bancario ?? ""}
                    pattern="[A-Za-z0-9.\-]{6,20}"
                    title="De 6 a 20 caracteres: letras, números, punto y guion"
                    className="campo"
                  />
                </div>
              </div>
            </div>
            <div>
              <label className="etiqueta">Observaciones</label>
              <textarea
                name="observaciones"
                rows={3}
                defaultValue={cliente?.observaciones ?? ""}
                className="campo"
              />
            </div>
          </>
        )}

        <label className="flex items-center gap-2 text-sm text-stone-600">
          <input type="checkbox" name="activo" defaultChecked={cliente?.activo ?? true} className="rounded" />
          Activo
        </label>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={pendiente} className="boton-primario">
            {cliente ? "Guardar cambios" : "Agregar cliente"}
          </button>
          {cancelarHref && (
            <Link href={cancelarHref} className="boton-secundario">
              Cancelar
            </Link>
          )}
        </div>
      </form>
      <ModalError estado={estado} />
    </>
  );
}
