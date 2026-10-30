/**
 * Autorización de un comprobante en ARCA (CAE), en un punto de venta
 * electrónico. Lógica pura: la base y ARCA llegan como dependencias, igual
 * que en obtenerTicket, para probarla sin Supabase ni red. La implementación
 * real está en ./autorizar-supabase.ts.
 *
 * Flujo (borrador o rechazado):
 *  1. Recalcula en el servidor letra, tipo, receptor y totales, valida y lo
 *     guarda en el borrador. Con errores de validación no se toca ARCA.
 *     Una nota de crédito o débito necesita su comprobante asociado o un
 *     período asociado (no los dos), lleva la letra del asociado (no la de
 *     la condición IVA actual del cliente; con período, la del cliente) y
 *     una nota de crédito no supera el saldo de los asociados de la base
 *     (con un período o un asociado cargado a mano no se controla).
 *  2. Toma el bloqueo de numeración (ambiente, punto de venta, tipo); si
 *     otro pedido lo tiene, espera un poco y se rinde. Una nota de crédito
 *     vuelve a controlar el saldo con el bloqueo tomado.
 *  3. Pide el ticket, consulta el último autorizado y numera último + 1.
 *  4. Pasa a "verificando" con ese número y pide el CAE:
 *     - aprobado: autorizado con número y CAE;
 *     - rechazo por número no correlativo (10016): reconsulta el último y
 *       reintenta una sola vez;
 *     - otro rechazo: rechazado, sin número;
 *     - error o respuesta incierta: queda en verificación.
 *  5. Libera el bloqueo siempre.
 *
 * Un comprobante en verificación se reconcilia antes de pedir otro CAE:
 * FECompConsultar con el número enviado. Si ARCA lo tiene con el mismo total
 * y documento, se guarda su CAE; si lo tiene con otros datos, ese número lo
 * usó otro sistema y queda rechazado para revisarlo; si no lo tiene, vuelve
 * a borrador y sigue el flujo normal. Nunca se pide un CAE dos veces para
 * el mismo número sin consultar antes.
 *
 * En un punto de venta no electrónico (comprobante X) no hay ARCA:
 * recalcula sin IVA (letra X, sin código), valida, lo guarda y lo numera
 * con autorizar_comprobante_interno, que lo pasa de borrador a autorizado
 * con el siguiente número de su punto de venta y clase.
 *
 * Ningún resultado lleva la clave privada, el token ni el sign.
 */
import { hoyArgentina } from "@/lib/clientes/seguimiento";
import {
  RespuestaArcaIncierta,
  type AsociadoSolicitud,
  type AuthWsfe,
  type ComprobanteConsultado,
  type MensajeWsfe,
  type RespuestaCae,
  type SolicitudCae,
} from "@/lib/arca/wsfe";
import {
  NOMBRES_AMBIENTE_ARCA,
  type AmbienteArca,
  type ClaseComprobante,
  type CondicionIva,
  type EstadoComprobante,
  type IvaAutorizado,
  type LetraArca,
  type LetraComprobante,
  type TipoComprobanteArca,
} from "@/lib/tipos";
import {
  mensajeExcedeSaldo,
  validarAsociadosNota,
  validarPeriodoAsociado,
  type PeriodoAsociado,
} from "./asociados";
import { calcularItem, calcularTotales, type ItemACalcular, type OpcionesCalculo, type Totales } from "./calculo";
import { condicionIvaReceptorId, documentoReceptor, letraYTipoNota } from "./letra";
import { formatearNumero } from "./numero";
import { validarParaAutorizar } from "./validacion";

// ----- Datos ---------------------------------------------------------------

export type ComprobanteAAutorizar = {
  id: string;
  estado: EstadoComprobante;
  puntoVenta: number;
  ambiente: AmbienteArca | null;
  clase: ClaseComprobante;
  letra: LetraComprobante | null;
  tipoArca: TipoComprobanteArca | null;
  /** yyyy-mm-dd */
  fecha: string;
  total: number;
  receptorDocNro: string | null;
  intentoNumero: number | null;
};

export type ItemAAutorizar = ItemACalcular & { id: string; importe: number; iva: number };

export type ClienteAAutorizar = {
  razonSocial: string | null;
  cuit: string | null;
  condicionIva: CondicionIva | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
};

/** Credencial del ambiente. La clave va cifrada y sólo la descifra obtenerTicket. */
export type CredencialArca = { certificadoPem: string; claveCifrada: string };

export type DatosAutorizacion = {
  comprobante: ComprobanteAAutorizar;
  items: ItemAAutorizar[];
  /** CbtesAsoc ya resueltos (de la base o cargados a mano). */
  asociados: AsociadoSolicitud[];
  /** Período asociado de una nota (PeriodoAsoc), en lugar de asociados. */
  periodo: PeriodoAsociado | null;
  cliente: ClienteAAutorizar;
  cuitEmisor: string | null;
  puntoVentaElectronico: boolean;
  credencial: CredencialArca | null;
  /**
   * Nota de crédito con asociados de la base: lo que queda para acreditar
   * (total de los asociados menos otras notas de crédito sobre ellos) y el
   * número del asociado para el mensaje. null si no aplica (factura, nota
   * de débito o asociado cargado a mano: no se conoce su importe).
   */
  saldoNotaCredito: { saldo: number; asociado: string } | null;
};

export type BorradorRecalculado = {
  letra: LetraComprobante;
  /** null en un X. */
  tipoArca: TipoComprobanteArca | null;
  receptor: {
    razonSocial: string;
    docTipo: number;
    docNro: string;
    condicionIva: CondicionIva;
    domicilio: string | null;
    provincia: string | null;
  };
  neto: number;
  noGravado: number;
  iva: number;
  total: number;
  /** Sólo los renglones cuyo importe o IVA cambió. */
  items: { id: string; importe: number; iva: number }[];
};

export type ClaveNumeracion = { ambiente: AmbienteArca; puntoVenta: number; tipoArca: TipoComprobanteArca };

export type RepositorioComprobantes = {
  cargar(id: string): Promise<DatosAutorizacion | null>;
  /** Guarda lo recalculado y deja el comprobante en borrador (sólo desde borrador o rechazado). */
  guardarRecalculado(id: string, datos: BorradorRecalculado): Promise<void>;
  /** borrador → verificando con el número y el IVA por alícuota que se envían a ARCA. */
  pasarAVerificando(
    id: string,
    datos: {
      intentoNumero: number;
      letra: LetraComprobante;
      tipoArca: TipoComprobanteArca;
      ivaDetalle: IvaAutorizado[];
    },
  ): Promise<void>;
  /**
   * Comprobante X: borrador → autorizado con el siguiente número de su punto
   * de venta y clase (autorizar_comprobante_interno). Devuelve el número.
   */
  autorizarInterno(id: string): Promise<number>;
  /** Cambia el número enviado (reintento por número no correlativo). */
  cambiarIntento(id: string, intentoNumero: number): Promise<void>;
  marcarAutorizado(
    id: string,
    datos: { numero: number; cae: string; caeVencimiento: string; observaciones: MensajeWsfe[]; autorizadoEn: Date },
  ): Promise<void>;
  /** verificando → rechazado, sin número. */
  marcarRechazado(
    id: string,
    datos: { resultado: "R" | null; observaciones: MensajeWsfe[]; errores: MensajeWsfe[] },
  ): Promise<void>;
  /** verificando → borrador, sin número. */
  volverABorrador(id: string): Promise<void>;
  /**
   * El saldo de DatosAutorizacion.saldoNotaCredito leído otra vez, con el
   * bloqueo de numeración tomado (ver emitir).
   */
  saldoNotaCredito(id: string): Promise<DatosAutorizacion["saldoNotaCredito"]>;
  /** Llave del bloqueo tomado, o null si otro pedido lo tiene. */
  tomarBloqueo(clave: ClaveNumeracion): Promise<string | null>;
  liberarBloqueo(clave: ClaveNumeracion, llave: string): Promise<void>;
};

export type ServiciosArca = {
  autenticar(ambiente: AmbienteArca, credencial: CredencialArca, cuitEmisor: string): Promise<AuthWsfe>;
  ultimoAutorizado(ambiente: AmbienteArca, auth: AuthWsfe, puntoVenta: number, tipo: number): Promise<number>;
  solicitarCae(ambiente: AmbienteArca, auth: AuthWsfe, solicitud: SolicitudCae): Promise<RespuestaCae>;
  consultar(
    ambiente: AmbienteArca,
    auth: AuthWsfe,
    puntoVenta: number,
    tipo: number,
    numero: number,
  ): Promise<ComprobanteConsultado | null>;
};

export type DependenciasAutorizacion = {
  repositorio: RepositorioComprobantes;
  arca: ServiciosArca;
  ahora?: () => Date;
  esperar?: (ms: number) => Promise<void>;
};

export type ResultadoAutorizacion = { ok?: string; error?: string; estado?: EstadoComprobante };

// ----- Errores -------------------------------------------------------------

/** Error de la base con su código (SQLSTATE o de PostgREST). */
export class ErrorBaseDatos extends Error {
  constructor(
    readonly codigo: string | undefined,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = "ErrorBaseDatos";
  }
}

/** Errores de los triggers de comprobante (ver 20261024000001_comprobantes.sql). */
const MENSAJES_BASE: Record<string, string> = {
  CM001: "El comprobante ya está autorizado: no se puede modificar. Para corregirlo, emití una nota de crédito.",
  CM002: "El comprobante cambió de estado mientras se autorizaba. Recargá la página y volvé a intentar.",
  CM003: "Sólo se pueden borrar borradores y rechazados.",
  CM004: "El comprobante se está verificando con ARCA: sus datos no se pueden cambiar hasta terminar la verificación.",
  CM005: "El punto de venta del comprobante no coincide con el ambiente de ARCA, o falta el CAE.",
  CM008: "La letra no corresponde al punto de venta: en uno electrónico va A o B, y en uno no electrónico va X.",
  CM009: "Un comprobante X no lleva código de ARCA, CAE ni IVA. Recargá la página y volvé a intentar.",
};

/** Mensaje legible de cualquier error. obtenerTicket ya traduce los de WSAA. */
export function mensajeError(error: unknown): string {
  if (error instanceof ErrorBaseDatos && error.codigo && MENSAJES_BASE[error.codigo]) {
    return MENSAJES_BASE[error.codigo];
  }
  if (error instanceof TypeError) return `No se pudo conectar con ARCA: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

// ----- Bloqueo -------------------------------------------------------------

/** Pausa entre intentos mientras otro pedido numera (igual que el ticket). */
export const ESPERA_BLOQUEO_MS = 500;
/** Cantidad de pausas antes de rendirse (6 × 500 ms = 3 s). */
export const INTENTOS_BLOQUEO = 6;

/** Código de WSFE para un número (o fecha) que no es el próximo a autorizar. */
const NO_CORRELATIVO = 10016;

type Contexto = {
  repositorio: RepositorioComprobantes;
  arca: ServiciosArca;
  ahora: () => Date;
  esperar: (ms: number) => Promise<void>;
};

/**
 * Corre `trabajo` con el bloqueo de numeración tomado y lo libera al final
 * (sólo si se tomó). Si no se consigue, devuelve un error sin correr nada.
 */
async function conBloqueo<T>(
  ctx: Contexto,
  clave: ClaveNumeracion,
  trabajo: () => Promise<T>,
): Promise<T | ResultadoAutorizacion> {
  let llave: string | null = null;
  for (let intento = 0; llave === null; intento++) {
    llave = await ctx.repositorio.tomarBloqueo(clave);
    if (llave !== null) break;
    if (intento >= INTENTOS_BLOQUEO) {
      return {
        error: `Otro pedido está numerando comprobantes de este tipo en el punto de venta ${clave.puntoVenta}. Probá de nuevo en un minuto.`,
      };
    }
    await ctx.esperar(ESPERA_BLOQUEO_MS);
  }
  try {
    return await trabajo();
  } finally {
    // Si liberar falla, el bloqueo vence solo: no se tapa el resultado.
    await ctx.repositorio.liberarBloqueo(clave, llave).catch(() => undefined);
  }
}

// ----- Formato -------------------------------------------------------------

function fechaIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

function fechaArgentina(iso: string): string {
  const [anio, mes, dia] = iso.split("-");
  return `${dia}/${mes}/${anio}`;
}

function pesos(valor: number): string {
  return `$ ${valor.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function describirMensajes(mensajes: readonly MensajeWsfe[]): string {
  return mensajes.map((m) => `[${m.code}] ${m.msg}`).join("; ");
}

/** Documento comparable: sólo dígitos, sin ceros a la izquierda. */
function documento(valor: string | null | undefined): string {
  return (valor ?? "").replace(/\D/g, "").replace(/^0+/, "") || "0";
}

// ----- Recalcular ----------------------------------------------------------

/**
 * Receptor, totales e ítems recalculados con la letra dada. Un X va sin IVA.
 * Se llama después de validarParaAutorizar: el cliente tiene razón social y
 * condición IVA.
 */
function recalcularBorrador(
  datos: DatosAutorizacion,
  letra: LetraComprobante,
  tipoArca: TipoComprobanteArca | null,
): { borrador: BorradorRecalculado; totales: Totales } {
  const { cliente, items } = datos;
  const opciones: OpcionesCalculo = { sinIva: letra === "X" };
  const condicionIva = cliente.condicionIva!;
  const doc = documentoReceptor(cliente.cuit, condicionIva, letra);
  const totales = calcularTotales(items, opciones);
  const domicilio = [cliente.direccion, cliente.localidad, cliente.provincia]
    .map((parte) => parte?.trim())
    .filter(Boolean)
    .join(", ");

  const borrador: BorradorRecalculado = {
    letra,
    tipoArca,
    receptor: {
      razonSocial: cliente.razonSocial!.trim(),
      docTipo: doc.docTipo,
      docNro: doc.docNro,
      condicionIva,
      domicilio: domicilio || null,
      provincia: cliente.provincia?.trim() || null,
    },
    neto: totales.neto,
    noGravado: totales.noGravado,
    iva: totales.iva,
    total: totales.total,
    items: items
      .map((item) => ({ id: item.id, ...calcularItem(item, opciones), antes: item }))
      .filter((r) => r.importe !== r.antes.importe || r.iva !== r.antes.iva)
      .map(({ id, importe, iva }) => ({ id, importe, iva })),
  };
  return { borrador, totales };
}

function recalcular(datos: DatosAutorizacion, letraAsociado: LetraComprobante | null) {
  const { comprobante, cliente } = datos;
  // Un asociado X no da letra de ARCA: la base no deja asociarlo a una nota A o B.
  const letraArca: LetraArca | null = letraAsociado === "X" ? null : letraAsociado;
  const { letra, tipoArca } = letraYTipoNota(cliente.condicionIva, comprobante.clase, letraArca);
  const { borrador, totales } = recalcularBorrador(datos, letra, tipoArca);
  const { docTipo, docNro } = borrador.receptor;
  const condicionIva = borrador.receptor.condicionIva;

  const solicitud = (numero: number): SolicitudCae => ({
    puntoVenta: comprobante.puntoVenta,
    tipoComprobante: tipoArca,
    numero,
    fecha: comprobante.fecha,
    docTipo,
    docNro,
    condicionIvaReceptorId: condicionIvaReceptorId(condicionIva),
    neto: totales.neto,
    noGravado: totales.noGravado,
    iva: totales.iva,
    total: totales.total,
    alicuotas: totales.ivaPorAlicuota.map(({ id, base, importe }) => ({ id, base, importe })),
    asociados: datos.asociados.length > 0 ? datos.asociados : undefined,
    ...(datos.periodo ? { periodo: datos.periodo } : {}),
  });

  // Lo mismo que va en el array Iva: se guarda para imprimirlo tal cual.
  const ivaDetalle: IvaAutorizado[] = totales.ivaPorAlicuota.map(({ id, alicuota, base, importe }) => ({
    id,
    alicuota,
    base,
    importe,
  }));

  return { borrador, solicitud, ivaDetalle, letra, tipoArca };
}

// ----- Flujo ---------------------------------------------------------------

function mensajeIncierto(error: unknown): string {
  return (
    `No se pudo confirmar el resultado con ARCA (${mensajeError(error)}). El comprobante quedó en verificación: ` +
    "apretá «Autorizar» de nuevo para verificarlo con ARCA. No lo cargues de nuevo."
  );
}

/** Autoriza el comprobante `id` en ARCA, o reconcilia uno que quedó en verificación. */
export async function autorizar(id: string, deps: DependenciasAutorizacion): Promise<ResultadoAutorizacion> {
  const ctx: Contexto = {
    repositorio: deps.repositorio,
    arca: deps.arca,
    ahora: deps.ahora ?? (() => new Date()),
    esperar: deps.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
  };
  try {
    return await ejecutar(ctx, id, true);
  } catch (e) {
    // Sólo llegan acá los errores anteriores a pedir el CAE (o a consultar):
    // el comprobante sigue como estaba.
    return { error: mensajeError(e) };
  }
}

async function ejecutar(ctx: Contexto, id: string, puedeReconciliar: boolean): Promise<ResultadoAutorizacion> {
  const datos = await ctx.repositorio.cargar(id);
  if (!datos) return { error: "No se encontró el comprobante." };
  const c = datos.comprobante;

  if (c.estado === "autorizado") return { error: "El comprobante ya está autorizado.", estado: "autorizado" };
  if (!datos.puntoVentaElectronico) return emitirInterno(ctx, datos);
  if (!c.ambiente) return { error: "El comprobante no tiene ambiente de ARCA." };
  if (!datos.credencial) {
    return {
      error: `Cargá el certificado y la clave de ARCA de ${NOMBRES_AMBIENTE_ARCA[c.ambiente].toLowerCase()} en Configuración → ARCA.`,
    };
  }
  if (!datos.cuitEmisor) return { error: "Completá la CUIT del emisor en Configuración → ARCA." };

  if (c.estado === "verificando") {
    if (!puedeReconciliar) return { error: "El comprobante sigue en verificación. Volvé a intentar en un minuto." };
    const resultado = await reconciliar(ctx, datos, c.ambiente, datos.credencial, datos.cuitEmisor);
    if (resultado !== "volver-a-emitir") return resultado;
    return ejecutar(ctx, id, false);
  }
  return emitir(ctx, datos, c.ambiente, datos.credencial, datos.cuitEmisor);
}

/** Comprobante X de un punto de venta no electrónico: sin ARCA (ver arriba). */
async function emitirInterno(ctx: Contexto, datos: DatosAutorizacion): Promise<ResultadoAutorizacion> {
  const { comprobante: c, cliente } = datos;
  if (c.estado !== "borrador" && c.estado !== "rechazado") {
    return { error: "Sólo se emite un borrador.", estado: c.estado };
  }
  // Asociados de una nota X: los valida la base (sólo comprobantes X).
  const erroresPeriodo = datos.periodo ? validarPeriodoAsociado(datos.periodo, c.fecha) : [];
  if (erroresPeriodo.length > 0) return { error: erroresPeriodo.join(" ") };
  const errores = validarParaAutorizar(
    {
      clase: c.clase,
      letra: "X",
      fecha: c.fecha,
      receptor: { razonSocial: cliente.razonSocial, condicionIva: cliente.condicionIva, cuit: cliente.cuit },
      items: datos.items,
    },
    hoyArgentina(ctx.ahora()),
  );
  if (errores.length > 0) return { error: errores.join(" ") };

  const { borrador } = recalcularBorrador(datos, "X", null);
  if (c.clase === "nota_credito" && datos.saldoNotaCredito) {
    const excede = mensajeExcedeSaldo(borrador.total, datos.saldoNotaCredito.saldo, datos.saldoNotaCredito.asociado);
    if (excede) return { error: excede };
  }
  await ctx.repositorio.guardarRecalculado(c.id, borrador);
  const numero = await ctx.repositorio.autorizarInterno(c.id);
  return { ok: `Comprobante ${formatearNumero("X", c.puntoVenta, numero)} emitido.`, estado: "autorizado" };
}

async function emitir(
  ctx: Contexto,
  datos: DatosAutorizacion,
  ambiente: AmbienteArca,
  credencial: CredencialArca,
  cuitEmisor: string,
): Promise<ResultadoAutorizacion> {
  const { comprobante: c, cliente } = datos;
  const asociados = validarAsociadosNota(
    c.clase,
    datos.asociados.map((a) => a.tipo),
    datos.periodo,
  );
  if ("error" in asociados) return { error: asociados.error };
  const erroresPeriodo = datos.periodo ? validarPeriodoAsociado(datos.periodo, c.fecha) : [];
  if (erroresPeriodo.length > 0) return { error: erroresPeriodo.join(" ") };
  const errores = validarParaAutorizar(
    {
      clase: c.clase,
      letra: asociados.letra,
      fecha: c.fecha,
      receptor: { razonSocial: cliente.razonSocial, condicionIva: cliente.condicionIva, cuit: cliente.cuit },
      items: datos.items,
    },
    hoyArgentina(ctx.ahora()),
  );
  if (errores.length > 0) return { error: errores.join(" ") };

  const { borrador, solicitud, ivaDetalle, letra, tipoArca } = recalcular(datos, asociados.letra);
  if (c.clase === "nota_credito" && datos.saldoNotaCredito) {
    const excede = mensajeExcedeSaldo(borrador.total, datos.saldoNotaCredito.saldo, datos.saldoNotaCredito.asociado);
    if (excede) return { error: excede };
  }
  await ctx.repositorio.guardarRecalculado(c.id, borrador);

  const clave: ClaveNumeracion = { ambiente, puntoVenta: c.puntoVenta, tipoArca };
  return conBloqueo(ctx, clave, async () => {
    if (c.clase === "nota_credito") {
      // El saldo de arriba se leyó sin bloqueo: dos notas de crédito sobre la
      // misma factura autorizadas a la vez podían pasar las dos. Se vuelve a
      // leer acá, antes de pasar a verificando. Las notas que lo consumen
      // cuentan desde que están en verificación, así que la que ganó el
      // bloqueo antes ya se descuenta. Alcanza porque el bloqueo es por
      // (ambiente, punto de venta, tipo): el ambiente y el tipo salen del
      // asociado (misma letra, misma clase), así que dos notas de crédito
      // sobre la misma factura en el mismo punto de venta se serializan.
      // Lo que NO cubre: el punto de venta de la nota lo elige el usuario
      // (armarNota usa el de la factura sólo si sigue activo, y el editor lo
      // deja cambiar). Dos notas de crédito sobre la misma factura en puntos
      // de venta distintos toman bloqueos distintos y pueden pasar las dos.
      const saldo = await ctx.repositorio.saldoNotaCredito(c.id);
      if (saldo) {
        const excede = mensajeExcedeSaldo(borrador.total, saldo.saldo, saldo.asociado);
        if (excede) return { error: excede };
      } else if (datos.saldoNotaCredito) {
        // Al cargar tenía un asociado de la base y bajo el bloqueo ya no: no se
        // sigue a ARCA sin el control de saldo.
        return {
          error: `El comprobante asociado ${datos.saldoNotaCredito.asociado} ya no está disponible: revisá la nota de crédito.`,
        };
      }
    }
    const auth = await ctx.arca.autenticar(ambiente, credencial, cuitEmisor);
    const ultimo = () => ctx.arca.ultimoAutorizado(ambiente, auth, c.puntoVenta, tipoArca);
    let numero = (await ultimo()) + 1;
    await ctx.repositorio.pasarAVerificando(c.id, { intentoNumero: numero, letra, tipoArca, ivaDetalle });

    // Desde acá ARCA pudo haber recibido el pedido: ante cualquier error el
    // comprobante queda en verificación y se reconcilia la próxima vez.
    try {
      let respuesta = await ctx.arca.solicitarCae(ambiente, auth, solicitud(numero));

      if (respuesta.resultado === "R" && [...respuesta.errores, ...respuesta.observaciones].some((m) => m.code === NO_CORRELATIVO)) {
        // Otro sistema emitió en el medio: el rechazo es definitivo, así que
        // si no se puede reintentar se guarda tal cual.
        let siguiente: number | null = null;
        try {
          siguiente = (await ultimo()) + 1;
          await ctx.repositorio.cambiarIntento(c.id, siguiente);
        } catch {
          siguiente = null;
        }
        if (siguiente !== null) {
          numero = siguiente;
          respuesta = await ctx.arca.solicitarCae(ambiente, auth, solicitud(numero));
        }
      }

      if (respuesta.resultado === "A") {
        const caeVencimiento = fechaIso(respuesta.caeVencimiento);
        await ctx.repositorio.marcarAutorizado(c.id, {
          numero,
          cae: respuesta.cae,
          caeVencimiento,
          observaciones: respuesta.observaciones,
          autorizadoEn: ctx.ahora(),
        });
        return {
          ok:
            `Comprobante ${formatearNumero(letra, c.puntoVenta, numero)} autorizado. ` +
            `CAE ${respuesta.cae}, vence el ${fechaArgentina(caeVencimiento)}.`,
          estado: "autorizado",
        };
      }

      await ctx.repositorio.marcarRechazado(c.id, {
        resultado: "R",
        observaciones: respuesta.observaciones,
        errores: respuesta.errores,
      });
      const motivos = describirMensajes([...respuesta.errores, ...respuesta.observaciones]);
      return {
        error: motivos ? `ARCA rechazó el comprobante: ${motivos}` : "ARCA rechazó el comprobante sin informar el motivo.",
        estado: "rechazado",
      };
    } catch (e) {
      return { error: mensajeIncierto(e), estado: "verificando" };
    }
  });
}

async function reconciliar(
  ctx: Contexto,
  datos: DatosAutorizacion,
  ambiente: AmbienteArca,
  credencial: CredencialArca,
  cuitEmisor: string,
): Promise<ResultadoAutorizacion | "volver-a-emitir"> {
  const c = datos.comprobante;
  const { letra, tipoArca, intentoNumero: numero } = c;
  if (!letra || !tipoArca || !numero) {
    return { error: "El comprobante en verificación no tiene el número enviado a ARCA." };
  }
  const clave: ClaveNumeracion = { ambiente, puntoVenta: c.puntoVenta, tipoArca };
  const nombre = formatearNumero(letra, c.puntoVenta, numero);

  return conBloqueo<ResultadoAutorizacion | "volver-a-emitir">(ctx, clave, async () => {
    let encontrado: ComprobanteConsultado | null;
    try {
      const auth = await ctx.arca.autenticar(ambiente, credencial, cuitEmisor);
      encontrado = await ctx.arca.consultar(ambiente, auth, c.puntoVenta, tipoArca, numero);
    } catch (e) {
      return {
        error:
          `No se pudo verificar el comprobante con ARCA (${mensajeError(e)}). Sigue en verificación: ` +
          "volvé a apretar «Autorizar» en un rato. No lo cargues de nuevo.",
        estado: "verificando",
      };
    }

    if (!encontrado) {
      // ARCA no lo tiene: el pedido no llegó o fue rechazado. Se puede volver a pedir.
      await ctx.repositorio.volverABorrador(c.id);
      return "volver-a-emitir";
    }

    const coincide =
      Math.abs(encontrado.importeTotal - c.total) < 0.005 && documento(encontrado.docNro) === documento(c.receptorDocNro);
    if (!coincide) {
      const mensaje =
        `ARCA ya tiene el comprobante ${nombre} con otros datos (total ${pesos(encontrado.importeTotal)}, ` +
        `documento ${encontrado.docNro ?? "sin informar"}): ese número lo usó otro sistema. ` +
        "Revisá ese comprobante antes de volver a autorizar este.";
      await ctx.repositorio.marcarRechazado(c.id, { resultado: null, observaciones: [], errores: [{ code: 0, msg: mensaje }] });
      return { error: mensaje, estado: "rechazado" };
    }

    if (!encontrado.caeVencimiento) {
      // Sin vencimiento no se puede guardar como autorizado: sigue en
      // verificación, igual que una respuesta incierta al emitir.
      return {
        error: mensajeIncierto(
          new RespuestaArcaIncierta(`ARCA tiene el comprobante ${nombre} pero no informó el vencimiento del CAE`),
        ),
        estado: "verificando",
      };
    }
    const caeVencimiento = fechaIso(encontrado.caeVencimiento);
    await ctx.repositorio.marcarAutorizado(c.id, {
      numero,
      cae: encontrado.cae,
      caeVencimiento,
      observaciones: [],
      autorizadoEn: ctx.ahora(),
    });
    return {
      ok: `ARCA ya había autorizado el comprobante ${nombre}. CAE ${encontrado.cae}, vence el ${fechaArgentina(caeVencimiento)}.`,
      estado: "autorizado",
    };
  });
}
