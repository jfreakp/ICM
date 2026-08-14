export interface JuicioItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo: string | null;
  tipo_identificacion: string | null;
  identificacion: string | null;
  nombre_completo: string | null;
  gestor_responsable: string | null;
  gestor_secretario: string | null;
  gestor_anulacion: string | null;
  gestor_suspension: string | null;
  gestor_reactivacion: string | null;
  motivo_anulacion: string | null;
  fecha_generacion: string | null;
  fecha_registro: string | null;
  fecha_inicio_juicio: string | null;
  fecha_notificacion: string | null;
  fecha_pago: string | null;
  fecha_fin: string | null;
  fecha_anulacion: string | null;
  fecha_suspension: string | null;
  fecha_reactivacion: string | null;
  valor_capital: number | null;
  valor_interes: number | null;
  valor_multas: number | null;
  valor_costas: number | null;
  valor_total: number | null;
}

export interface JuicioListResponse {
  items: JuicioItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface JuicioFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
