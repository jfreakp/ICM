export interface TituloItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo_titulo_credito: string | null;
  tipo_identificacion: string | null;
  identificacion: string | null;
  nombre_completo: string | null;
  etapa_cobranza: string | null;
  estado: string | null;
  codigo_referencia: string | null;
  concepto: string | null;
  nombre_elabora_titulo: string | null;
  nombre_solicita: string | null;
  nombre_aprobacion: string | null;
  motivo_anulacion: string | null;
  fecha_generacion: string | null;
  fecha_registro: string | null;
  fecha_elaboracion: string | null;
  fecha_solicitud: string | null;
  fecha_aprobacion: string | null;
  fecha_notificacion: string | null;
  fecha_pago: string | null;
  fecha_anulacion: string | null;
  valor: number | null;
  multas: number | null;
  interes: number | null;
  valor_total: number | null;
  estado_catalogo_item_id: number | null;
  etapa_cobranza_catalogo_item_id: number | null;
  tipo_identificacion_catalogo_item_id: number | null;
}

export interface TituloListResponse {
  items: TituloItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface TituloFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
