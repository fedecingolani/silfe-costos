import type { DatosListaDescarga, ItemListaDescarga } from "./tipos";

/** Ítems parecidos a la lista de referencia (diciembre 2023), para los tests. */
export const itemsDeReferencia: ItemListaDescarga[] = [
  {
    codigo: "001",
    descripcion: "Recolector grande con correa reforzada",
    presentacion: "Unidad",
    alicuota_iva: 21,
    precio_final: 24500,
    es_repuesto: false,
  },
  {
    codigo: "101",
    descripcion: "Correa para recolector",
    presentacion: "Docena",
    alicuota_iva: 21,
    precio_final: 18300,
    es_repuesto: true,
  },
  {
    codigo: "102",
    descripcion: "Malla de repuesto",
    presentacion: "Docena",
    alicuota_iva: 10.5,
    precio_final: 9750.5,
    es_repuesto: true,
  },
  {
    codigo: "103",
    descripcion: "Aro de fondo",
    presentacion: "Docena",
    alicuota_iva: 21,
    precio_final: 4200,
    es_repuesto: true,
  },
  {
    codigo: "002",
    descripcion: "Lona cosechera 4 x 4 m",
    presentacion: null,
    alicuota_iva: 10.5,
    precio_final: 1250000,
    es_repuesto: false,
  },
  {
    codigo: null,
    descripcion: "Flete a cargo del cliente – consultar",
    presentacion: null,
    alicuota_iva: 21,
    precio_final: 0,
    es_repuesto: false,
  },
];

export const datosDeReferencia: DatosListaDescarga = {
  titulo: "LISTA DE PRECIOS DICIEMBRE 2023",
  items: itemsDeReferencia,
  textoDestacado: "SIL – FE 30 AÑOS",
  contacto: "Ventas: (0299) 555-1234\nventas@silfe.com.ar\nCipolletti, Río Negro",
  logo: null,
};
