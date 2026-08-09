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
