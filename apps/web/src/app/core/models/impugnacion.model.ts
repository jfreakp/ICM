export interface ImpugnacionItem {
  id: number;
  registro: string | null;
  fecha_registro: string | null;
  fecha_acta: string | null;
  estado: string | null;
  codigo_infraccion_axis: string | null;
  contravencion: string | null;
  tipo_acta: string | null;
  articulo_original: string | null;
  monto_capital_original: number | null;
  observacion: string | null;
  hora_generacion: string | null;
  fecha_generacion: string | null;
  numero_credito: string | null;
  numero_tramite: string | null;
  codigo_infraccion_generada_axis: string | null;
  juzgado: string | null;
  codigo_provincia: string | null;
  codigo_localidad: string | null;
  numero_proceso: string | null;
  monto_modificado_sentencia: number | null;
  puntos_original: string | null;
  puntos_modificados_sentencia: string | null;
  literal_original: string | null;
  articulo_modificado_sentencia: string | null;
  literal_modificado_sentencia: string | null;
  fecha_vencimiento_original: string | null;
  fecha_vencimiento_modificado_sentencia: string | null;
  sancion_original: string | null;
  sancion_modificada_sentencia: string | null;
  codigo_usuario: string | null;
  codigo_usuario_aprueba: string | null;
  numero_acta_juzgamiento: string | null;
  fecha_aprobacion: string | null;
  fecha_anulacion: string | null;
  codigo_usuario_anula: string | null;
  observacion_anulacion: string | null;
  articulo_original_catalogo_item_id: number | null;
  articulo_modificado_sentencia_catalogo_item_id: number | null;
  codigo_localidad_catalogo_item_id: number | null;
  codigo_provincia_catalogo_item_id: number | null;
  tipo_acta_catalogo_item_id: number | null;
}

export interface ImpugnacionListResponse {
  items: ImpugnacionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ImpugnacionFilters {
  fecha_desde: string;
  fecha_hasta: string;
  estado: string | null;
}
