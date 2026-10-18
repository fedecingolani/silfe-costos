/**
 * Importe en letras para el recibo ("la suma de pesos … CON 78/100"), en
 * mayúsculas y con tildes, como se escribe en los documentos comerciales:
 *   123.456,78 → CIENTO VEINTITRÉS MIL CUATROCIENTOS CINCUENTA Y SEIS CON 78/100
 * Delante de MIL y MILLONES, "uno" se apocopa: VEINTIÚN MIL, UN MILLÓN,
 * TREINTA Y UN MILLONES. Hasta 999.999.999.999,99 (sin billones).
 */
import { aCentavos } from "./dinero";

const HASTA_29 = [
  "",
  "UNO",
  "DOS",
  "TRES",
  "CUATRO",
  "CINCO",
  "SEIS",
  "SIETE",
  "OCHO",
  "NUEVE",
  "DIEZ",
  "ONCE",
  "DOCE",
  "TRECE",
  "CATORCE",
  "QUINCE",
  "DIECISÉIS",
  "DIECISIETE",
  "DIECIOCHO",
  "DIECINUEVE",
  "VEINTE",
  "VEINTIUNO",
  "VEINTIDÓS",
  "VEINTITRÉS",
  "VEINTICUATRO",
  "VEINTICINCO",
  "VEINTISÉIS",
  "VEINTISIETE",
  "VEINTIOCHO",
  "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = [
  "",
  "CIENTO",
  "DOSCIENTOS",
  "TRESCIENTOS",
  "CUATROCIENTOS",
  "QUINIENTOS",
  "SEISCIENTOS",
  "SETECIENTOS",
  "OCHOCIENTOS",
  "NOVECIENTOS",
];

/** Tope: un billón (10^12) en pesos. */
const TOPE = 1_000_000_000_000;

/** 1 a 99. Con `apocope`, "UNO" final pasa a "UN" (VEINTIÚN, TREINTA Y UN). */
function decenas(n: number, apocope: boolean): string {
  const texto = n < 30 ? HASTA_29[n] : n % 10 === 0 ? DECENAS[n / 10] : `${DECENAS[Math.floor(n / 10)]} Y ${HASTA_29[n % 10]}`;
  if (!apocope) return texto;
  return texto.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");
}

/** 1 a 999. */
function centenas(n: number, apocope: boolean): string {
  if (n === 100) return "CIEN";
  const partes: string[] = [];
  if (n >= 100) partes.push(CENTENAS[Math.floor(n / 100)]);
  if (n % 100 > 0) partes.push(decenas(n % 100, apocope));
  return partes.join(" ");
}

/** 1 a 999.999. */
function miles(n: number, apocope: boolean): string {
  const millares = Math.floor(n / 1000);
  const resto = n % 1000;
  const partes: string[] = [];
  if (millares === 1) partes.push("MIL");
  else if (millares > 1) partes.push(`${centenas(millares, true)} MIL`);
  if (resto > 0) partes.push(centenas(resto, apocope));
  return partes.join(" ");
}

/** Parte entera en letras (0 a 999.999.999.999). */
function enteroEnLetras(n: number): string {
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const partes: string[] = [];
  if (millones === 1) partes.push("UN MILLÓN");
  else if (millones > 1) partes.push(`${miles(millones, true)} MILLONES`);
  if (resto > 0) partes.push(miles(resto, false));
  return partes.join(" ");
}

/** "CIENTO VEINTITRÉS MIL CUATROCIENTOS CINCUENTA Y SEIS CON 78/100". */
export function numeroEnLetras(importe: number): string {
  if (!Number.isFinite(importe) || importe < 0) {
    throw new RangeError(`No se puede escribir en letras el importe ${importe}.`);
  }
  const totalCentavos = aCentavos(importe);
  const pesos = Math.floor(totalCentavos / 100);
  if (pesos >= TOPE) throw new RangeError(`El importe ${importe} es demasiado grande para escribirlo en letras.`);
  const centavos = totalCentavos % 100;
  return `${enteroEnLetras(pesos)} CON ${String(centavos).padStart(2, "0")}/100`;
}
