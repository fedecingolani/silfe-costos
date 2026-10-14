import * as XLSX from "xlsx";
import type { DatosListaDescarga } from "./tipos";

const ENCABEZADOS = ["Código", "Descripción", "Presentación", "Precio sin IVA", "IVA %", "Repuesto"];

/** Fila (base 0) de los encabezados: el título va en la primera fila y queda una en blanco. */
const FILA_ENCABEZADOS = 2;

/** Genera el .xlsx de una lista: una hoja con el título, los encabezados y un ítem por fila. */
export function generarExcel(datos: DatosListaDescarga): Uint8Array {
  const filas: (string | number | null)[][] = [
    [datos.titulo],
    [],
    ENCABEZADOS,
    ...datos.items.map((item) => [
      item.codigo ?? null,
      item.descripcion,
      item.presentacion ?? null,
      Number(item.precio_final),
      Number(item.alicuota_iva),
      item.es_repuesto ? "Sí" : "No",
    ]),
  ];

  const hoja = XLSX.utils.aoa_to_sheet(filas);

  // Formato de número con separador de miles para la columna de precios.
  datos.items.forEach((_, i) => {
    const celda = hoja[XLSX.utils.encode_cell({ r: FILA_ENCABEZADOS + 1 + i, c: 3 })];
    if (celda) celda.z = "#,##0.00";
  });

  hoja["!cols"] = [{ wch: 10 }, { wch: 50 }, { wch: 14 }, { wch: 16 }, { wch: 8 }, { wch: 10 }];
  hoja["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ENCABEZADOS.length - 1 } }];

  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Lista de precios");
  const salida: ArrayBuffer = XLSX.write(libro, { type: "array", bookType: "xlsx" });
  return new Uint8Array(salida);
}
