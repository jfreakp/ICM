export interface InfraccionItem {
  id: number;
  registro: string | null;
  fecha_registro: string | null;
  fecha_emision: string | null;
  fecha_aprobacion: string | null;
  fecha_vencimiento: string | null;
  estado: string | null;
  codigo_infraccion: string | null;
  codigo_infraccion_ant: string | null;
  contravencion: string | null;
  articulo: string | null;
  literal: string | null;
  descripcion_articulo: string | null;
  periodo_fiscal: string | null;
  oficina: string | null;
  origen_registro: string | null;
  tipo_registro_infraccion: string | null;
  tipo_emision: string | null;
  tipo_deudor: string | null;
  codigo_usuario_registra: string | null;
  observacion: string | null;
  provincia: string | null;
  localidad: string | null;
  lugar_infraccion: string | null;
  canal: string | null;
  placa: string | null;
  tipo_identificacion_infractor: string | null;
  numero_identificacion_infractor: string | null;
  nombre_infractor: string | null;
  tipo_identificacion_propietario: string | null;
  numero_identificacion_propietario: string | null;
  nombre_propietario: string | null;
  indicador_bloqueada: string | null;
  indicador_acta_juzgamiento: string | null;
  indicador_modificada: string | null;
  indicador_calcula_recargo: string | null;
  valor_capital: number | null;
  valor_capital_exonerado: number | null;
  valor_recargo: number | null;
  valor_recargo_exonerado: number | null;
  valor_intereses: number | null;
  valor_total: number | null;
  deleted_at: string | null;
}

export interface InfraccionListResponse {
  items: InfraccionItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface InfraccionFilters {
  fecha_desde: string;
  fecha_hasta: string;
  estado: string | null;
}
