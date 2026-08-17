export interface LibretinItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo_libretin: string | null;
  prefijo_boleta: string | null;
  rango_inicio_boleta: string | null;
  rango_fin_boleta: string | null;
  cantidad_boletas: string | null;
  longitud_boleta: string | null;
  estado: string | null;
  codigo_tramite: string | null;
  codigo_usuario_creacion: string | null;
  codigo_tramite_asignacion: string | null;
  codigo_usuario_asignacion: string | null;
  codigo_usuario_inactiva: string | null;
  observacion: string | null;
  codigo_agente: string | null;
  identificacion_agente: string | null;
  agente: string | null;
  codigo_distrito: string | null;
  descripcion_distrito: string | null;
  codigo_oficina: string | null;
  descripcion_oficina: string | null;
  codigo_provincia: string | null;
  descripcion_provincia: string | null;
  codigo_localidad: string | null;
  descripcion_localidad: string | null;
  tipo: string | null;
  origen_tramite: string | null;
  motivo_baja: string | null;
  disponibles: string | null;
  utilizadas: string | null;
  desactivadas: string | null;
  fecha_generacion: string | null;
  fecha_registro: string | null;
  fecha_asignacion: string | null;
  fecha_inactivacion: string | null;
  codigo_localidad_catalogo_item_id: number | null;
  codigo_provincia_catalogo_item_id: number | null;
  estado_catalogo_item_id: number | null;
  tipo_catalogo_item_id: number | null;
}

export interface LibretinListResponse {
  items: LibretinItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface LibretinFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
