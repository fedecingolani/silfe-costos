/**
 * Lógica pura del seguimiento de clientes: fechas en hora argentina, el
 * estado de seguimiento (el mismo cálculo que hace v_cliente_seguimiento en
 * la base) y los filtros que llegan por la URL.
 */
import type { EstadoSeguimiento } from "@/lib/tipos";

export const ZONA_HORARIA = "America/Argentina/Buenos_Aires";

/**
 * Desfase fijo de Argentina. No tiene horario de verano desde 2009: si
 * volviera a tenerlo, hay que cambiar esto y fechaLocalAIso.
 */
const DESFASE_ARGENTINA = "-03:00";

/** Partes de una fecha y hora en la zona de Argentina. */
function partesArgentina(fecha: Date) {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONA_HORARIA,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const valor = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value ?? "";
  return {
    fecha: `${valor("year")}-${valor("month")}-${valor("day")}`,
    hora: `${valor("hour")}:${valor("minute")}`,
  };
}

/** Fecha de hoy (YYYY-MM-DD) en Argentina, sin importar la zona del servidor. */
export function hoyArgentina(ahora: Date = new Date()): string {
  return partesArgentina(ahora).fecha;
}

/** Suma (o resta) días a una fecha YYYY-MM-DD. */
export function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + dias)).toISOString().slice(0, 10);
}

/**
 * Estado de seguimiento según la fecha del próximo contacto, con las mismas
 * reglas que la vista: antes de hoy atrasado, hoy, de 1 a 7 días próximo,
 * después más adelante, y sin fecha sin agenda.
 */
export function estadoSeguimiento(proximo: string | null | undefined, hoy: string): EstadoSeguimiento {
  if (!proximo) return "sin_agenda";
  if (proximo < hoy) return "atrasado";
  if (proximo === hoy) return "hoy";
  if (proximo <= sumarDias(hoy, 7)) return "proximo";
  return "mas_adelante";
}

type Tono = "neutro" | "verde" | "ambar" | "rojo" | "azul";

/** Etiqueta y color (tono de Pastilla) de cada estado. */
export const ESTADOS_SEGUIMIENTO: Record<EstadoSeguimiento, { etiqueta: string; tono: Tono }> = {
  atrasado: { etiqueta: "Atrasado", tono: "rojo" },
  hoy: { etiqueta: "Hoy", tono: "ambar" },
  proximo: { etiqueta: "Próximo", tono: "azul" },
  mas_adelante: { etiqueta: "Más adelante", tono: "neutro" },
  sin_agenda: { etiqueta: "Sin agenda", tono: "neutro" },
};

export type ValorFiltroSeguimiento = "todos" | "atrasados" | "hoy" | "proximos" | "sin-agenda";

const FILTROS: Record<Exclude<ValorFiltroSeguimiento, "todos">, EstadoSeguimiento> = {
  atrasados: "atrasado",
  hoy: "hoy",
  proximos: "proximo",
  "sin-agenda": "sin_agenda",
};

/** Filtro de seguimiento del listado de clientes (?seguimiento=). Por defecto, todos. */
export function filtroSeguimiento(valor: string | null | undefined): {
  valor: ValorFiltroSeguimiento;
  estado: EstadoSeguimiento | null;
} {
  if (valor && Object.hasOwn(FILTROS, valor)) {
    const clave = valor as keyof typeof FILTROS;
    return { valor: clave, estado: FILTROS[clave] };
  }
  return { valor: "todos", estado: null };
}

/** Valor para un input datetime-local (YYYY-MM-DDTHH:mm) en hora argentina. */
export function fechaLocalArgentina(valor: string | Date): string {
  const { fecha, hora } = partesArgentina(typeof valor === "string" ? new Date(valor) : valor);
  return `${fecha}T${hora}`;
}

/**
 * Interpreta el valor de un input datetime-local como hora argentina y lo
 * devuelve como ISO con desfase, para guardarlo en un timestamptz. El
 * servidor puede correr en UTC: sin esto, la hora se correría 3 horas.
 * null si está vacío o no es una fecha válida.
 */
export function fechaLocalAIso(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  const partes = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(texto);
  if (!partes) return null;
  const [, a, m, d, hh, mm, ss = "00"] = partes;
  const control = new Date(Date.UTC(+a, +m - 1, +d, +hh, +mm, +ss));
  if (
    control.getUTCFullYear() !== +a ||
    control.getUTCMonth() !== +m - 1 ||
    control.getUTCDate() !== +d ||
    control.getUTCHours() !== +hh ||
    control.getUTCMinutes() !== +mm
  ) {
    return null;
  }
  return `${a}-${m}-${d}T${hh}:${mm}:${ss}${DESFASE_ARGENTINA}`;
}

/**
 * A dónde volver después de registrar o editar una interacción. Sólo se
 * acepta la pantalla de seguimiento (con sus filtros); cualquier otra cosa
 * vuelve a la ficha del cliente, para no redirigir a un sitio externo.
 */
export function rutaDeVuelta(valor: string | null | undefined, clienteId: string): string {
  const texto = (valor ?? "").trim();
  if (/^\/seguimiento(\?[\w=&%.-]*)?$/.test(texto)) return texto;
  return `/clientes/${clienteId}`;
}

/** Corta un texto largo y le agrega puntos suspensivos. */
export function truncar(texto: string | null | undefined, largo: number): string | null {
  if (!texto) return null;
  return texto.length > largo ? `${texto.slice(0, largo - 1).trimEnd()}…` : texto;
}
