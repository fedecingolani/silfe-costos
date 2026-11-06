/**
 * Helpers puros de la pantalla Configuración → Integraciones (claves de API).
 * La generación y el hash de la clave están en ./clave.ts.
 */

import type { ApiClaveVisible } from "@/lib/tipos";

export type EstadoClave = "activa" | "revocada";

/** Fila de la tabla de claves, con las fechas ya formateadas. */
export type FilaClave = {
  id: string;
  nombre: string;
  prefijo: string;
  creada: string;
  ultimoUso: string;
  estado: EstadoClave;
  revocada: string | null;
};

const LARGO_MAXIMO_NOMBRE = 100;

/** Una clave revocada se sigue listando, pero no autentica más. */
export function estadoClave(fila: { revocada_en: string | null }): EstadoClave {
  return fila.revocada_en ? "revocada" : "activa";
}

/**
 * Arma la fila de la tabla. Las fechas se formatean en el servidor: el
 * formato de Intl difiere entre Node y el navegador y rompería la
 * hidratación. Copia sólo los campos visibles (nunca el hash).
 */
export function filaClave(clave: ApiClaveVisible, formatear: (valor: string) => string): FilaClave {
  return {
    id: clave.id,
    nombre: clave.nombre,
    prefijo: clave.prefijo,
    creada: formatear(clave.creado_en),
    ultimoUso: clave.ultimo_uso_en ? formatear(clave.ultimo_uso_en) : "Nunca",
    estado: estadoClave(clave),
    revocada: clave.revocada_en ? formatear(clave.revocada_en) : null,
  };
}

/** Nombre de la integración para la que se crea la clave (api_clave.nombre). */
export function validarNombreClave(valor: string | null): { nombre: string } | { error: string } {
  const nombre = (valor ?? "").trim();
  if (!nombre) return { error: "Ingresá un nombre para la clave (por ejemplo, Factura Digital)." };
  if (nombre.length > LARGO_MAXIMO_NOMBRE) {
    return { error: `El nombre no puede tener más de ${LARGO_MAXIMO_NOMBRE} caracteres.` };
  }
  return { nombre };
}

/**
 * URL base de la API a partir del host y el protocolo del pedido
 * (`host` y `x-forwarded-proto`). Sin protocolo, http sólo en local.
 */
export function urlBaseApi(host: string | null, protocolo: string | null): string | null {
  if (!host) return null;
  const informado = protocolo?.split(",")[0]?.trim();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const esquema = informado || (local ? "http" : "https");
  return `${esquema}://${host}/api/v1`;
}

/** Referencia corta de los endpoints, para configurar la integración. */
export const ENDPOINTS_API = [
  { metodo: "GET", ruta: "/proveedores?cuit=<CUIT>", descripcion: "Busca un proveedor por CUIT." },
  { metodo: "POST", ruta: "/proveedores", descripcion: "Da de alta un proveedor." },
  {
    metodo: "POST",
    ruta: "/comprobantes-compra",
    descripcion: "Crea una factura, nota de crédito o de débito de compra en borrador.",
  },
] as const;
