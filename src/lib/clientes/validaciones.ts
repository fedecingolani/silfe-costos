/**
 * Validaciones de datos fiscales y bancarios del cliente.
 *
 * Son avisos, no bloqueos: la pantalla los muestra junto al campo y la base
 * sólo controla el formato (22 dígitos en CBU y CVU, caracteres del alias).
 * Un campo vacío es válido porque todos estos datos son opcionales.
 */
export type Validacion = {
  valido: boolean;
  /** Valor limpio (sin guiones ni espacios) si tiene el formato correcto; null si no. */
  normalizado: string | null;
  /** Aviso para mostrar junto al campo; null si es válido. */
  mensaje: string | null;
};

const VACIO: Validacion = { valido: true, normalizado: null, mensaje: null };

function texto(valor: string | null | undefined): string {
  return (valor ?? "").trim();
}

function suma(digitos: string, pesos: number[]): number {
  return [...digitos].reduce((acc, d, i) => acc + Number(d) * pesos[i], 0);
}

/**
 * CUIT/CUIL: 11 dígitos, con o sin guiones (XX-XXXXXXXX-X). El último es el
 * verificador de AFIP: módulo 11 con pesos 5,4,3,2,7,6,5,4,3,2.
 */
export function validarCuit(valor: string | null | undefined): Validacion {
  const limpio = texto(valor);
  if (limpio === "") return VACIO;
  if (!/^\d{2}-?\d{8}-?\d$/.test(limpio)) {
    return { valido: false, normalizado: null, mensaje: "El CUIT debe tener 11 dígitos (XX-XXXXXXXX-X)." };
  }
  const digitos = limpio.replace(/-/g, "");
  const resto = suma(digitos.slice(0, 10), [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]) % 11;
  const verificador = (11 - resto) % 11;
  // Un resultado de 10 no es un verificador posible: AFIP cambia el prefijo.
  if (verificador === 10 || verificador !== Number(digitos[10])) {
    return { valido: false, normalizado: digitos, mensaje: "El dígito verificador del CUIT no cierra." };
  }
  return { valido: true, normalizado: digitos, mensaje: null };
}

/** Verificador de un bloque de CBU: clave 10 con el ponderador 9713. */
function verificadorCbu(bloque: string, pesos: number[]): number {
  return (10 - (suma(bloque, pesos) % 10)) % 10;
}

const PESOS_BLOQUE_1 = [7, 1, 3, 9, 7, 1, 3];
const PESOS_BLOQUE_2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3];

/** Los dos verificadores del CBU/CVU (posiciones 8 y 22) cierran. */
function verificadoresCierran(digitos: string): boolean {
  return (
    verificadorCbu(digitos.slice(0, 7), PESOS_BLOQUE_1) === Number(digitos[7]) &&
    verificadorCbu(digitos.slice(8, 21), PESOS_BLOQUE_2) === Number(digitos[21])
  );
}

function veintidosDigitos(valor: string | null | undefined): string | null {
  const limpio = texto(valor).replace(/[\s-]/g, "");
  return /^\d{22}$/.test(limpio) ? limpio : null;
}

/**
 * CBU (BCRA): 22 dígitos en dos bloques. Bloque 1: banco (3), sucursal (4) y
 * verificador. Bloque 2: cuenta (13) y verificador.
 */
export function validarCbu(valor: string | null | undefined): Validacion {
  if (texto(valor) === "") return VACIO;
  const digitos = veintidosDigitos(valor);
  if (!digitos) return { valido: false, normalizado: null, mensaje: "El CBU debe tener 22 dígitos." };
  if (!verificadoresCierran(digitos)) {
    return { valido: false, normalizado: digitos, mensaje: "Los dígitos verificadores del CBU no cierran." };
  }
  return { valido: true, normalizado: digitos, mensaje: null };
}

/**
 * CVU (BCRA, cuentas de proveedores de servicios de pago): mismo formato que
 * el CBU, empieza con "000" y sus verificadores se calculan igual.
 */
export function validarCvu(valor: string | null | undefined): Validacion {
  if (texto(valor) === "") return VACIO;
  const digitos = veintidosDigitos(valor);
  if (!digitos) return { valido: false, normalizado: null, mensaje: "El CVU debe tener 22 dígitos." };
  if (!digitos.startsWith("000")) {
    return { valido: false, normalizado: digitos, mensaje: "Un CVU empieza con 000: ¿no es un CBU?" };
  }
  if (!verificadoresCierran(digitos)) {
    return { valido: false, normalizado: digitos, mensaje: "Los dígitos verificadores del CVU no cierran." };
  }
  return { valido: true, normalizado: digitos, mensaje: null };
}

/** Alias de CBU/CVU: de 6 a 20 caracteres, letras, números, punto y guion. */
export function validarAlias(valor: string | null | undefined): Validacion {
  const limpio = texto(valor);
  if (limpio === "") return VACIO;
  if (!/^[A-Za-z0-9.-]{6,20}$/.test(limpio)) {
    return {
      valido: false,
      normalizado: null,
      mensaje: "El alias lleva de 6 a 20 caracteres: letras, números, punto y guion.",
    };
  }
  return { valido: true, normalizado: limpio, mensaje: null };
}
