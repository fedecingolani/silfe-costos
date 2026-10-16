export type TipoProducto = "TERMINADO" | "SUBGRUPO";
export type TipoComponente = "MATERIA_PRIMA" | "SUBGRUPO";
export type ModoCosteo = "TIEMPO" | "FIJO";
export type Magnitud = "MASA" | "LONGITUD" | "SUPERFICIE" | "VOLUMEN" | "UNIDAD";

export type UnidadMedida = {
  id: string;
  codigo: string;
  nombre: string;
  magnitud: Magnitud;
};

export type Proveedor = {
  id: string;
  nombre: string;
  cuit: string | null;
  contacto: string | null;
  email: string | null;
  telefono: string | null;
  notas: string | null;
  activo: boolean;
};

export type ProveedorContacto = {
  id: string;
  proveedor_id: string;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  orden: number;
};

export type Zona = {
  id: string;
  nombre: string;
};

export type Cliente = {
  id: string;
  codigo_legado: number | null;
  razon_social: string;
  cuit: string | null;
  /** Sólo los dígitos del CUIT: columna generada, de sólo lectura, para buscar con o sin guiones. */
  cuit_digitos: string | null;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  codigo_postal: string | null;
  telefono: string | null;
  zona_id: string | null;
  activo: boolean;
  condicion_iva: CondicionIva | null;
  /** 22 dígitos; la base valida el formato y la app avisa si los verificadores no cierran. */
  cbu: string | null;
  /** 22 dígitos, empieza con 000. */
  cvu: string | null;
  alias_bancario: string | null;
  /** Transporte habitual; una sucursal puede tener uno propio. */
  transporte_id: string | null;
  observaciones: string | null;
};

export const CONDICIONES_IVA = [
  "Responsable Inscripto",
  "Monotributista",
  "Exento",
  "Consumidor Final",
] as const;

export type CondicionIva = (typeof CONDICIONES_IVA)[number];

export type Transporte = {
  id: string;
  nombre: string;
  telefono: string | null;
  observaciones: string | null;
  activo: boolean;
};

/** Sucursal o dirección de entrega de un cliente. */
export type ClienteSucursal = {
  id: string;
  cliente_id: string;
  nombre: string;
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  codigo_postal: string | null;
  telefono: string | null;
  observaciones: string | null;
  recibe_entregas: boolean;
  /** Dirección de entrega principal; una sola por cliente. */
  principal: boolean;
  /** Transporte propio; null = el habitual del cliente. */
  transporte_id: string | null;
  orden: number;
};

export type ClienteContacto = {
  id: string;
  cliente_id: string;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  whatsapp: string | null;
  observaciones: string | null;
  /** Sucursal del mismo cliente donde trabaja el contacto. */
  sucursal_id: string | null;
  orden: number;
};

export const TIPOS_INTERACCION = ["LLAMADO", "VISITA", "WHATSAPP", "EMAIL", "OTRO"] as const;
export type TipoInteraccion = (typeof TIPOS_INTERACCION)[number];

export const ETIQUETAS_TIPO_INTERACCION: Record<TipoInteraccion, string> = {
  LLAMADO: "Llamado",
  VISITA: "Visita",
  WHATSAPP: "WhatsApp",
  EMAIL: "Email",
  OTRO: "Otro",
};

export const SENTIDOS_INTERACCION = ["SALIENTE", "ENTRANTE"] as const;
export type SentidoInteraccion = (typeof SENTIDOS_INTERACCION)[number];

export const ETIQUETAS_SENTIDO_INTERACCION: Record<SentidoInteraccion, string> = {
  SALIENTE: "Saliente (lo iniciamos nosotros)",
  ENTRANTE: "Entrante (nos contactó el cliente)",
};

/** Contacto con un cliente (llamado, visita, mensaje) y el próximo paso. */
export type ClienteInteraccion = {
  id: string;
  cliente_id: string;
  /** Contacto del mismo cliente; null si no se eligió o se borró. */
  contacto_id: string | null;
  tipo: TipoInteraccion;
  sentido: SentidoInteraccion;
  /** timestamptz (ISO). */
  fecha: string;
  resumen: string;
  notas: string | null;
  /** YYYY-MM-DD. La agenda del cliente es la de su interacción cargada más recientemente. */
  proximo_contacto: string | null;
  proxima_accion: string | null;
  realizado_por: string | null;
  realizado_por_email: string | null;
  creado_en: string;
  actualizado_en: string;
};

/** Estado de seguimiento, calculado en v_cliente_seguimiento contra la fecha de Argentina. */
export type EstadoSeguimiento = "atrasado" | "hoy" | "proximo" | "mas_adelante" | "sin_agenda";

/** Fila de v_cliente_seguimiento: un cliente con su último y su próximo contacto. */
export type ClienteSeguimiento = {
  cliente_id: string;
  codigo_legado: number | null;
  razon_social: string;
  cuit: string | null;
  cuit_digitos: string | null;
  localidad: string | null;
  telefono: string | null;
  zona_id: string | null;
  /** Nombre de la zona. */
  zona: string | null;
  transporte_id: string | null;
  activo: boolean;
  ultima_interaccion_id: string | null;
  ultima_interaccion_fecha: string | null;
  ultima_interaccion_tipo: TipoInteraccion | null;
  ultimo_resumen: string | null;
  proximo_contacto: string | null;
  proxima_accion: string | null;
  estado_seguimiento: EstadoSeguimiento;
};

export type MateriaPrima = {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  unidad_compra_id: string;
  unidad_uso_id: string;
  factor_conversion: number;
  merma_pct: number;
  activo: boolean;
  notas: string | null;
};

export type MateriaPrimaCosto = {
  id: string;
  codigo: string;
  nombre: string;
  categoria: string | null;
  activo: boolean;
  factor_conversion: number;
  merma_pct: number;
  unidad_compra_id: string;
  unidad_compra: string;
  unidad_uso_id: string;
  unidad_uso: string;
  precio_id: string | null;
  proveedor_id: string | null;
  proveedor: string | null;
  precio_compra: number | null;
  moneda: string | null;
  vigente_desde: string | null;
  costo_unitario_uso: number | null;
  costo_unitario_uso_con_merma: number | null;
};

export type PrecioMateriaPrima = {
  id: string;
  materia_prima_id: string;
  proveedor_id: string | null;
  precio: number;
  moneda: string;
  incluye_iva: boolean;
  vigente_desde: string;
  es_preferido: boolean;
  observaciones: string | null;
};

export type CategoriaManoObra = {
  id: string;
  nombre: string;
  costo_hora: number;
  cargas_sociales_pct: number;
  activo: boolean;
};

export type Proceso = {
  id: string;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  activo: boolean;
};

export type Producto = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoProducto;
  descripcion: string | null;
  unidad_id: string | null;
  activo: boolean;
  /** Alícuota de IVA en porcentaje (ej. 10.5, 21). */
  alicuota_iva: number;
  /** Unidad de la presentación de venta; null = igual a unidad_id. */
  unidad_venta_id: string | null;
  /** Unidades de costeo por presentación de venta. */
  factor_venta: number;
};

export type ProductoCosto = {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoProducto;
  activo: boolean;
  descripcion: string | null;
  materiales_directos: number;
  materiales_subgrupos: number;
  mano_obra_directa: number;
  mano_obra_subgrupos: number;
  minutos_totales: number;
  moneda: string;
  gastos_generales_pct: number;
  margen_pct: number;
  costo_materiales: number;
  costo_mano_obra: number;
  costo_directo: number;
  gastos_generales: number;
  costo_total: number;
  precio_sugerido: number;
  alicuota_iva: number;
  /** Ya resuelta: unidad_venta_id del producto o, si falta, su unidad_id. */
  unidad_venta_id: string | null;
  factor_venta: number;
  /** precio_sugerido × factor_venta. */
  precio_presentacion: number;
};

export type ComponenteDetalle = {
  id: string;
  producto_id: string;
  tipo: TipoComponente;
  orden: number;
  cantidad: number;
  merma_pct: number;
  notas: string | null;
  materia_prima_id: string | null;
  subgrupo_id: string | null;
  codigo: string;
  nombre: string;
  unidad: string;
  proveedor: string | null;
  merma_material_pct: number | null;
  costo_unitario: number | null;
  cantidad_con_merma: number;
  costo_total: number | null;
  sin_precio: boolean;
};

export type ProcesoCosto = {
  id: string;
  producto_id: string;
  proceso_id: string;
  proceso_codigo: string;
  proceso: string;
  orden: number;
  modo: ModoCosteo;
  minutos: number | null;
  categoria_mano_obra_id: string | null;
  categoria: string | null;
  costo_hora: number | null;
  cargas_sociales_pct: number | null;
  costo_hora_cargado: number | null;
  costo_fijo: number | null;
  cantidad_por_ciclo: number;
  notas: string | null;
  costo: number | null;
  minutos_por_unidad: number;
};

export type ExplosionMaterial = {
  producto_id: string;
  subgrupo_id: string | null;
  subgrupo_nombre: string | null;
  materia_prima_id: string;
  codigo: string;
  nombre: string;
  unidad: string;
  proveedor: string | null;
  cantidad: number;
  costo: number;
};

export type UsoMateriaPrima = {
  materia_prima_id: string;
  producto_id: string;
  producto_codigo: string;
  producto_nombre: string;
  producto_tipo: TipoProducto;
  subgrupo_nombre: string | null;
  cantidad: number;
  costo: number;
};

export type ParametroCosteo = {
  id: boolean;
  moneda: string;
  gastos_generales_pct: number;
  margen_pct: number;
  /** Texto grande y centrado del pie de la lista en PDF. null: no se imprime. */
  lista_texto_destacado: string | null;
  /** Contacto del pie de la lista en PDF, en varias líneas. null: no se imprime. */
  lista_contacto: string | null;
};

/** Lista de precios guardada. Inmutable: para corregirla se duplica. */
export type ListaPrecio = {
  id: string;
  nombre: string;
  /** Encabezado impreso (ej. "LISTA DE PRECIOS DICIEMBRE 2023"). */
  titulo: string | null;
  notas: string | null;
  creado_en: string;
  creado_por: string | null;
};

/** Ítem de una lista guardada: foto de los datos al crear la lista. */
export type ListaPrecioItem = {
  id: string;
  lista_id: string;
  orden: number;
  es_repuesto: boolean;
  /** null en los ítems manuales. */
  producto_id: string | null;
  codigo: string | null;
  descripcion: string;
  /** Nombre de la unidad de la presentación de venta (ej. "Docena"). */
  presentacion: string | null;
  alicuota_iva: number;
  /** Precio de la presentación calculado, sin redondear; null en los manuales. */
  precio_sugerido: number | null;
  precio_final: number;
};

/** Fila de v_lista_precio_base: punto de partida de una lista nueva. */
export type ListaPrecioBase = {
  orden: number;
  es_repuesto: boolean;
  producto_id: string;
  /** TERMINADO debajo del cual va el repuesto; null en productos y otros repuestos. */
  padre_producto_id: string | null;
  codigo: string;
  descripcion: string;
  presentacion: string | null;
  alicuota_iva: number;
  /** precio_presentacion de v_producto_costo. */
  precio_sugerido: number | null;
  /** precio_sugerido redondeado hacia arriba a la centena. */
  precio_redondeado: number | null;
  /**
   * Falta el precio vigente de alguna materia prima (propia o de un subgrupo)
   * o el precio sugerido es 0: hace falta un precio manual.
   */
  costos_incompletos: boolean;
};

// ---------------------------------------------------------------------
// ARCA (facturación electrónica)
// ---------------------------------------------------------------------

export const AMBIENTES_ARCA = ["homologacion", "produccion"] as const;

export type AmbienteArca = (typeof AMBIENTES_ARCA)[number];

export const NOMBRES_AMBIENTE_ARCA: Record<AmbienteArca, string> = {
  homologacion: "Homologación",
  produccion: "Producción",
};

export const CONDICIONES_IVA_EMISOR = ["Responsable Inscripto", "Monotributista", "Exento"] as const;

export type CondicionIvaEmisor = (typeof CONDICIONES_IVA_EMISOR)[number];

/** Fila única de arca_emisor. */
export type ArcaEmisor = {
  id: true;
  /** 11 dígitos sin guiones; null hasta configurarla. */
  cuit: string | null;
  razon_social: string | null;
  condicion_iva: CondicionIvaEmisor | null;
  /** Obsoleta: los puntos de venta están en la tabla punto_venta. */
  punto_venta: number | null;
  ambiente: AmbienteArca;
  /** Datos que se imprimen en los comprobantes. */
  domicilio_comercial: string | null;
  ingresos_brutos: string | null;
  /** yyyy-mm-dd */
  inicio_actividades: string | null;
  actualizado_en: string;
};

/**
 * Fila de arca_credencial. clave_cifrada y ta_cifrado son texto cifrado
 * (AES-256-GCM, "v1.<iv>.<datos>") y no deben salir hacia el navegador.
 */
export type ArcaCredencial = {
  ambiente: AmbienteArca;
  certificado_pem: string;
  certificado_titular: string | null;
  certificado_cuit: string;
  certificado_vence: string;
  clave_cifrada: string;
  ta_cifrado: string | null;
  ta_expira: string | null;
  ta_bloqueado_hasta: string | null;
  creado_en: string;
  actualizado_en: string;
};

/**
 * Lo que la pantalla de ARCA lee de arca_credencial: nunca la clave cifrada
 * ni el ticket, sólo el vencimiento del ticket para mostrar si está vigente.
 */
export type ArcaCredencialVisible = Pick<
  ArcaCredencial,
  "ambiente" | "certificado_titular" | "certificado_cuit" | "certificado_vence" | "ta_expira" | "actualizado_en"
>;

/** Ticket de acceso de WSAA para un servicio (12 h de vigencia). */
export type TicketAcceso = {
  token: string;
  sign: string;
  expira: Date;
};

// ---------------------------------------------------------------------
// Comprobantes de venta
// ---------------------------------------------------------------------

/** Fila de punto_venta. */
export type PuntoVenta = {
  numero: number;
  nombre: string | null;
  /** true: numera y autoriza en ARCA (CAE). false: numeración propia, sin ARCA. */
  electronico: boolean;
  activo: boolean;
  creado_en: string;
};

export const ESTADOS_COMPROBANTE = ["borrador", "verificando", "autorizado", "rechazado"] as const;

export type EstadoComprobante = (typeof ESTADOS_COMPROBANTE)[number];

export const CLASES_COMPROBANTE = ["factura", "nota_credito", "nota_debito"] as const;

export type ClaseComprobante = (typeof CLASES_COMPROBANTE)[number];

export const NOMBRES_CLASE_COMPROBANTE: Record<ClaseComprobante, string> = {
  factura: "Factura",
  nota_credito: "Nota de crédito",
  nota_debito: "Nota de débito",
};

export type LetraComprobante = "A" | "B";

/** Códigos de ARCA: A = 1 / 2 / 3, B = 6 / 7 / 8 (factura / nota de débito / nota de crédito). */
export type TipoComprobanteArca = 1 | 2 | 3 | 6 | 7 | 8;

export const CONDICIONES_PAGO = ["cuenta_corriente", "contado"] as const;

export type CondicionPago = (typeof CONDICIONES_PAGO)[number];

export const NOMBRES_CONDICION_PAGO: Record<CondicionPago, string> = {
  cuenta_corriente: "Cuenta corriente",
  contado: "Contado",
};

/** Alícuotas de IVA que acepta ARCA, en %. */
export const ALICUOTAS_IVA = [0, 2.5, 5, 10.5, 21, 27] as const;

export type AlicuotaIva = (typeof ALICUOTAS_IVA)[number];

/** Código y mensaje tal como los devuelve ARCA (Obs o Err). */
export type MensajeArca = { code: number; msg: string };

/** Fila de comprobante. Los importes llegan de Postgres como números. */
export type Comprobante = {
  id: string;
  punto_venta: number;
  /** Vacío en puntos de venta no electrónicos. */
  ambiente: AmbienteArca | null;
  estado: EstadoComprobante;
  clase: ClaseComprobante;
  letra: LetraComprobante | null;
  tipo_arca: TipoComprobanteArca | null;
  /** Vacío hasta autorizar. */
  numero: number | null;
  /** yyyy-mm-dd */
  fecha: string;
  fecha_vencimiento_pago: string;
  cliente_id: string;
  lista_precio_id: string | null;
  condicion_pago: CondicionPago;
  observaciones: string | null;
  moneda: string;
  receptor_razon_social: string | null;
  receptor_doc_tipo: number | null;
  receptor_doc_nro: string | null;
  receptor_condicion_iva: CondicionIva | null;
  receptor_domicilio: string | null;
  receptor_provincia: string | null;
  neto: number;
  iva: number;
  total: number;
  cae: string | null;
  cae_vencimiento: string | null;
  arca_resultado: "A" | "R" | "P" | null;
  arca_observaciones: MensajeArca[] | null;
  arca_errores: MensajeArca[] | null;
  /** Número enviado a ARCA mientras el comprobante está en verificación. */
  intento_numero: number | null;
  creado_por: string | null;
  creado_en: string;
  actualizado_en: string;
  autorizado_en: string | null;
};

/** Fila de comprobante_item. producto_id vacío = ítem libre. */
export type ComprobanteItem = {
  id: string;
  comprobante_id: string;
  orden: number;
  producto_id: string | null;
  codigo: string | null;
  descripcion: string;
  observaciones: string | null;
  unidad: string | null;
  cantidad: number;
  /** Sin IVA, 4 decimales. */
  precio_unitario: number;
  descuento_pct: number;
  alicuota_iva: AlicuotaIva;
  importe: number;
  iva: number;
};

/**
 * Fila de comprobante_asociado: apunta a un comprobante de la base
 * (asociado_id) o lleva a mano los datos de uno del sistema anterior.
 */
export type ComprobanteAsociado = {
  id: string;
  comprobante_id: string;
  asociado_id: string | null;
  tipo_arca: TipoComprobanteArca | null;
  punto_venta: number | null;
  numero: number | null;
  fecha: string | null;
  cuit: string | null;
};
