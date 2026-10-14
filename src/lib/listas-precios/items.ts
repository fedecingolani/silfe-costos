import { esUuid } from "./uuid";

/** Ítem tal como lo manda el editor, en el orden de la pantalla. */
export type ItemListaEnviado = {
  es_repuesto: boolean;
  producto_id: string | null;
  codigo: string;
  descripcion: string;
  presentacion: string;
  alicuota_iva: string;
  precio_sugerido: number | null;
  precio_final: string;
};

/** Ítem validado, listo para crear_lista_precio. */
export type ItemValidado = {
  orden: number;
  es_repuesto: boolean;
  producto_id: string | null;
  codigo: string | null;
  descripcion: string;
  presentacion: string | null;
  alicuota_iva: number;
  precio_sugerido: number | null;
  precio_final: number;
};

export type ResultadoValidacion = { items: ItemValidado[] } | { errores: string[] };

type ItemCrudo = Partial<Record<keyof ItemListaEnviado, unknown>>;

function texto(valor: unknown): string | null {
  if (typeof valor !== "string") return null;
  const recortado = valor.trim();
  return recortado === "" ? null : recortado;
}

/**
 * Número finito a partir de un texto con coma o punto decimal, o de un número.
 * "vacio" si no hay valor; "invalido" si no es un número finito.
 */
function leerNumero(valor: unknown): number | "vacio" | "invalido" {
  if (valor === null || valor === undefined) return "vacio";
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : "invalido";
  if (typeof valor !== "string") return "invalido";
  const limpio = valor.trim().replace(",", ".");
  if (limpio === "") return "vacio";
  const n = Number(limpio);
  return Number.isFinite(n) ? n : "invalido";
}

/** producto_id válidos (uuid) del envío, sin repetir. */
export function productosEnviados(crudo: unknown): string[] {
  if (!Array.isArray(crudo)) return [];
  const ids = crudo
    .map((valor) => (typeof valor === "object" && valor !== null ? (valor as ItemCrudo).producto_id : null))
    .filter(esUuid);
  return [...new Set(ids)];
}

/**
 * Repite en el servidor las validaciones del editor y arma los ítems para
 * crear_lista_precio, con orden 1..n explícito.
 *
 * - Un producto_id que no es un uuid se rechaza (no se convierte en manual).
 * - Los productos de `costosIncompletos` exigen un precio final mayor a 0.
 * - Los ítems manuales no llevan precio sugerido.
 */
export function validarItems(crudo: unknown, costosIncompletos: ReadonlySet<string>): ResultadoValidacion {
  if (!Array.isArray(crudo) || crudo.length === 0) {
    return { errores: ["La lista necesita al menos un ítem."] };
  }

  const errores: string[] = [];
  const items: ItemValidado[] = [];

  crudo.forEach((valor: unknown, i) => {
    const posicion = i + 1;
    if (typeof valor !== "object" || valor === null || Array.isArray(valor)) {
      errores.push(`El ítem ${posicion} no es válido.`);
      return;
    }
    const item = valor as ItemCrudo;

    const descripcion = texto(item.descripcion);
    if (!descripcion) {
      errores.push(`El ítem ${posicion} necesita una descripción.`);
      return;
    }
    const nombre = `El ítem ${posicion} (${descripcion})`;

    let productoId: string | null = null;
    if (item.producto_id !== null && item.producto_id !== undefined && item.producto_id !== "") {
      if (!esUuid(item.producto_id)) {
        errores.push(`${nombre} tiene un producto inválido.`);
        return;
      }
      productoId = item.producto_id;
    }

    const precioFinal = leerNumero(item.precio_final);
    if (typeof precioFinal !== "number" || precioFinal < 0) {
      errores.push(`${nombre} necesita un precio final mayor o igual a 0.`);
      return;
    }
    if (productoId && costosIncompletos.has(productoId) && precioFinal <= 0) {
      errores.push(`${nombre} tiene costos incompletos: el precio final tiene que ser mayor a 0.`);
      return;
    }

    const ivaLeido = leerNumero(item.alicuota_iva);
    const iva = ivaLeido === "vacio" ? 21 : ivaLeido;
    if (typeof iva !== "number" || iva < 0 || iva > 100) {
      errores.push(`El IVA del ítem ${posicion} (${descripcion}) tiene que estar entre 0 y 100.`);
      return;
    }

    const sugerido = item.precio_sugerido;
    const precioSugerido =
      productoId && typeof sugerido === "number" && Number.isFinite(sugerido) && sugerido >= 0 ? sugerido : null;

    items.push({
      orden: posicion,
      es_repuesto: item.es_repuesto === true,
      producto_id: productoId,
      codigo: texto(item.codigo),
      descripcion,
      presentacion: texto(item.presentacion),
      alicuota_iva: iva,
      precio_sugerido: precioSugerido,
      precio_final: precioFinal,
    });
  });

  return errores.length > 0 ? { errores } : { items };
}
