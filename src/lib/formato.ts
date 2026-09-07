const monedaFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const monedaFinaFmt = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function pesos(valor: number | null | undefined, fina = false) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  return (fina ? monedaFinaFmt : monedaFmt).format(valor);
}

export function numero(valor: number | null | undefined, decimales = 2) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  return new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
  }).format(valor);
}

export function porcentaje(valor: number | null | undefined, decimales = 1) {
  if (valor === null || valor === undefined || Number.isNaN(valor)) return "—";
  return `${numero(valor, decimales)}%`;
}

export function minutosAHoras(minutos: number | null | undefined) {
  if (!minutos) return "—";
  const h = Math.floor(minutos / 60);
  const m = Math.round(minutos % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

export function fecha(valor: string | null | undefined) {
  if (!valor) return "—";
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium" }).format(new Date(`${valor}T00:00:00`));
}

/** Convierte strings de formulario a número, aceptando coma decimal. */
export function aNumero(valor: FormDataEntryValue | null, porDefecto: number | null = null) {
  if (valor === null) return porDefecto;
  const texto = String(valor).trim().replace(",", ".");
  if (texto === "") return porDefecto;
  const n = Number(texto);
  return Number.isFinite(n) ? n : porDefecto;
}

export function aTexto(valor: FormDataEntryValue | null): string | null {
  if (valor === null) return null;
  const texto = String(valor).trim();
  return texto === "" ? null : texto;
}

/** Sugiere el próximo código correlativo (ej. "MP-013") a partir de los códigos existentes. */
export function sugerirCodigo(prefijo: string, codigosExistentes: string[], digitos = 3): string {
  const regex = new RegExp(`^${prefijo}-(\\d+)$`, "i");
  const maximo = codigosExistentes.reduce((max, codigo) => {
    const match = codigo.match(regex);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefijo}-${String(maximo + 1).padStart(digitos, "0")}`;
}
