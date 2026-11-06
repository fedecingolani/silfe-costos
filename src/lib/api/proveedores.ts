/**
 * Validación pura de la API de proveedores (/api/v1/proveedores). El CUIT
 * se normaliza igual que en la pantalla (sólo dígitos, ver
 * src/lib/proveedores/validacion.ts): así se encuentra y no se repite.
 */
import { MENSAJE_CUIT_INVALIDO, validarCuit } from "@/lib/proveedores/validacion";
import { CONDICIONES_IVA, type CondicionIva } from "@/lib/tipos";

/** Lo que devuelve la API de cada proveedor. */
export const COLUMNAS_PROVEEDOR_API = "id, nombre, cuit, condicion_iva, domicilio";

export type ProveedorApi = {
  id: string;
  nombre: string;
  cuit: string | null;
  condicion_iva: CondicionIva | null;
  domicilio: string | null;
};

/** Columnas de proveedor que se insertan desde la API. */
export type ProveedorNuevoApi = Omit<ProveedorApi, "id"> & { cuit: string };

const MENSAJE_CUIT_FALTANTE = "Indicá el CUIT (11 dígitos) en ?cuit=.";
const CONDICIONES_TEXTO = `${CONDICIONES_IVA.slice(0, -1).join(", ")} o ${CONDICIONES_IVA[CONDICIONES_IVA.length - 1]}`;

export function esObjetoPlano(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

/** El CUIT de `GET ?cuit=`, normalizado. */
export function validarCuitConsulta(valor: string | null): { cuit: string } | { error: string } {
  const cuit = validarCuit(valor);
  if ("error" in cuit) return { error: MENSAJE_CUIT_INVALIDO };
  if (cuit.datos === null) return { error: MENSAJE_CUIT_FALTANTE };
  return { cuit: cuit.datos };
}

/** Texto opcional: null, undefined o vacío es null; otro tipo es un error. */
function textoOpcional(valor: unknown): { valor: string | null } | { error: string } {
  if (valor === null || valor === undefined) return { valor: null };
  if (typeof valor !== "string") return { error: "tiene que ser texto." };
  const t = valor.trim();
  return { valor: t === "" ? null : t };
}

/** El cuerpo de `POST /api/v1/proveedores`. Junta todos los errores, con el campo adelante. */
export function validarProveedorNuevo(cuerpo: unknown): { datos: ProveedorNuevoApi } | { errores: string[] } {
  if (!esObjetoPlano(cuerpo)) return { errores: ["El cuerpo tiene que ser un objeto JSON."] };
  const errores: string[] = [];

  const nombre = typeof cuerpo.nombre === "string" ? cuerpo.nombre.trim() : "";
  if (nombre === "") errores.push("nombre: es obligatorio.");

  let cuit: string | null = null;
  if (typeof cuerpo.cuit !== "string" || cuerpo.cuit.trim() === "") {
    errores.push("cuit: es obligatorio.");
  } else {
    const validado = validarCuit(cuerpo.cuit);
    if ("error" in validado) errores.push(`cuit: ${validado.error}`);
    else cuit = validado.datos;
  }

  const condicion = textoOpcional(cuerpo.condicion_iva);
  let condicionIva: CondicionIva | null = null;
  if ("error" in condicion) errores.push(`condicion_iva: ${condicion.error}`);
  else if (condicion.valor !== null) {
    if ((CONDICIONES_IVA as readonly string[]).includes(condicion.valor)) condicionIva = condicion.valor as CondicionIva;
    else errores.push(`condicion_iva: tiene que ser ${CONDICIONES_TEXTO}.`);
  }

  const domicilio = textoOpcional(cuerpo.domicilio);
  if ("error" in domicilio) errores.push(`domicilio: ${domicilio.error}`);

  if (errores.length > 0) return { errores };
  return {
    datos: {
      nombre,
      cuit: cuit!,
      condicion_iva: condicionIva,
      domicilio: "valor" in domicilio ? domicilio.valor : null,
    },
  };
}
