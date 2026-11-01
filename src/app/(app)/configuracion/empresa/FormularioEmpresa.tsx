"use client";

import { useActionState, useState, type ChangeEvent } from "react";
import { ModalError } from "@/components/ModalError";
import { esColorHex } from "@/lib/empresa/validacion";
import { enviarSinReiniciar } from "@/lib/formularios";
import type { EstadoFormularioEmpresa } from "./acciones";

type Accion = (estado: EstadoFormularioEmpresa, formData: FormData) => Promise<EstadoFormularioEmpresa>;

/** Datos que muestra el formulario. `logo` es una data URL para la vista previa. */
export type EmpresaFormulario = {
  nombre_fantasia: string | null;
  color_marca: string | null;
  telefono: string | null;
  email: string | null;
  web: string | null;
  logo: string | null;
};

/** Color que muestra el selector cuando todavía no hay uno cargado: el verde por defecto de la app. */
const COLOR_POR_DEFECTO = "#4a7a58";

export function FormularioEmpresa({ accion, empresa }: { accion: Accion; empresa: EmpresaFormulario | null }) {
  const [estado, accionFormulario, pendiente] = useActionState(accion, undefined);
  // Campos controlados y envío por onSubmit (ver enviarSinReiniciar).
  const [valores, setValores] = useState({
    nombre_fantasia: empresa?.nombre_fantasia ?? "",
    color_marca: empresa?.color_marca ?? "",
    telefono: empresa?.telefono ?? "",
    email: empresa?.email ?? "",
    web: empresa?.web ?? "",
  });
  const [quitarLogo, setQuitarLogo] = useState(false);
  const cambiar = (e: ChangeEvent<HTMLInputElement>) => setValores((v) => ({ ...v, [e.target.name]: e.target.value }));
  const colorSelector = esColorHex(valores.color_marca) ? valores.color_marca : COLOR_POR_DEFECTO;

  return (
    <>
      <form onSubmit={enviarSinReiniciar(accionFormulario)} className="space-y-3 p-4">
        <div>
          <label className="etiqueta">Nombre de fantasía</label>
          <input
            name="nombre_fantasia"
            maxLength={80}
            value={valores.nombre_fantasia}
            onChange={cambiar}
            className="campo"
          />
          <p className="mt-1 text-xs text-stone-500">
            Se muestra en el menú. Si queda vacío, se usa la razón social cargada en ARCA.
          </p>
        </div>
        <div>
          <label className="etiqueta">Color de marca</label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Elegir color de marca"
              value={colorSelector}
              onChange={(e) => setValores((v) => ({ ...v, color_marca: e.target.value }))}
              className="h-9 w-12 cursor-pointer rounded border border-stone-300 bg-white"
            />
            <input
              name="color_marca"
              value={valores.color_marca}
              onChange={cambiar}
              placeholder={COLOR_POR_DEFECTO}
              className="campo"
            />
          </div>
          <p className="mt-1 text-xs text-stone-500">Hex de 6 dígitos. Vacío usa el verde por defecto.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Teléfono</label>
            <input name="telefono" maxLength={40} value={valores.telefono} onChange={cambiar} className="campo" />
          </div>
          <div>
            <label className="etiqueta">Email</label>
            <input name="email" type="email" value={valores.email} onChange={cambiar} className="campo" />
          </div>
        </div>
        <div>
          <label className="etiqueta">Web</label>
          <input name="web" maxLength={200} value={valores.web} onChange={cambiar} className="campo" />
        </div>
        <div>
          <label className="etiqueta">Logo</label>
          {empresa?.logo ? (
            <div className="mb-2 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL de la base, sin optimizar */}
              <img
                src={empresa.logo}
                alt="Logo actual"
                className={`h-16 max-w-48 rounded border border-stone-200 bg-white object-contain p-1 ${
                  quitarLogo ? "opacity-30" : ""
                }`}
              />
              <label className="flex items-center gap-1.5 text-sm text-stone-600">
                <input
                  type="checkbox"
                  name="quitar_logo"
                  checked={quitarLogo}
                  onChange={(e) => setQuitarLogo(e.target.checked)}
                />
                Quitar logo
              </label>
            </div>
          ) : (
            <p className="mb-2 text-xs text-stone-500">Sin logo cargado.</p>
          )}
          <input
            type="file"
            name="logo"
            accept="image/png,image/jpeg"
            className="block w-full text-sm text-stone-600"
          />
          <p className="mt-1 text-xs text-stone-500">
            PNG o JPEG de hasta 512 KB. Se imprime en los PDF y se muestra en el menú.
          </p>
        </div>
        <button disabled={pendiente} className="boton-primario">
          Guardar empresa
        </button>
        {estado?.ok && <p className="text-xs text-marca-700">{estado.ok}</p>}
      </form>
      <ModalError estado={estado} />
    </>
  );
}
