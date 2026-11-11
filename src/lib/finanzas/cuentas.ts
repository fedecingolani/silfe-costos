// Validación pura del formulario de una cuenta de fondos (banco o caja).
// Repite los checks de `cuenta_fondos` para devolver un mensaje claro antes
// de ir a la base.

import { esAliasValido, normalizarCbu } from "@/lib/proveedores/validacion";
import type { TipoCuentaFondos } from "@/lib/tipos";

/** Lo que llega del formulario, todo como texto. */
export type EntradaCuenta = {
  nombre: string | null;
  banco: string | null;
  numero_cuenta: string | null;
  cbu: string | null;
  alias: string | null;
  observacion: string | null;
  activa: boolean;
};

/** Columnas editables de `cuenta_fondos`. */
export type DatosCuenta = {
  tipo: TipoCuentaFondos;
  nombre: string;
  banco: string | null;
  numero_cuenta: string | null;
  cbu: string | null;
  alias: string | null;
  observacion: string | null;
  activa: boolean;
};

type Resultado<T> = { datos: T } | { error: string };

const CBU = /^[0-9]{22}$/;

function limpiar(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  return texto === "" ? null : texto;
}

/** Una caja no tiene datos bancarios: se descartan aunque lleguen. */
export function validarCuenta(tipo: TipoCuentaFondos, entrada: EntradaCuenta): Resultado<DatosCuenta> {
  const nombre = limpiar(entrada.nombre);
  if (nombre === null) return { error: "El nombre de la cuenta es obligatorio." };
  const base = { tipo, nombre, observacion: limpiar(entrada.observacion), activa: entrada.activa };
  if (tipo === "caja") {
    return { datos: { ...base, banco: null, numero_cuenta: null, cbu: null, alias: null } };
  }
  const cbu = normalizarCbu(entrada.cbu);
  if (cbu !== null && !CBU.test(cbu)) return { error: "El CBU tiene que tener 22 dígitos." };
  const alias = limpiar(entrada.alias);
  if (alias !== null && !esAliasValido(alias)) {
    return { error: "El alias tiene que tener de 6 a 20 caracteres: letras, números, puntos o guiones." };
  }
  return {
    datos: { ...base, banco: limpiar(entrada.banco), numero_cuenta: limpiar(entrada.numero_cuenta), cbu, alias },
  };
}

/** Textos y ruta de la pantalla de cada tipo de cuenta (Bancos y Caja). */
export const PANTALLA_CUENTAS: Record<
  TipoCuentaFondos,
  { ruta: string; titulo: string; descripcion: string; nueva: string; vacio: string }
> = {
  banco: {
    ruta: "/bancos",
    titulo: "Bancos",
    descripcion: "Cuentas bancarias de la empresa con su saldo. El saldo inicial se carga como un ajuste.",
    nueva: "Nueva cuenta bancaria",
    vacio: "Todavía no hay cuentas bancarias.",
  },
  caja: {
    ruta: "/caja",
    titulo: "Caja",
    descripcion: "Cajas de efectivo de la empresa con su saldo. El saldo inicial se carga como un ajuste.",
    nueva: "Nueva caja",
    vacio: "Todavía no hay cajas.",
  },
};
