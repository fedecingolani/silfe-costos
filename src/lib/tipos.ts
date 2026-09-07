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
  direccion: string | null;
  localidad: string | null;
  provincia: string | null;
  codigo_postal: string | null;
  telefono: string | null;
  zona_id: string | null;
  activo: boolean;
};

export type ClienteContacto = {
  id: string;
  cliente_id: string;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  orden: number;
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
};
