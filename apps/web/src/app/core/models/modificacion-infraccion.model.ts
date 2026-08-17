export interface ModificacionInfraccionItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo_infraccion_original: string | null;
  contravencion: string | null;
  observacion: string | null;
  codigo_infraccion_acta: string | null;
  codigo_usuario_modifica: string | null;
  numero_credito: string | null;
  fecha_generacion: string | null;
  fecha_registro: string | null;
}

export interface ModificacionInfraccionListResponse {
  items: ModificacionInfraccionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface ModificacionInfraccionFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
