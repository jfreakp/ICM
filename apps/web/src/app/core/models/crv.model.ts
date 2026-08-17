export interface CrvItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  codigo_orden_crv: string | null;
  codigo_actividad: string | null;
  codigo_oficina: string | null;
  descripcion_oficina: string | null;
  placa: string | null;
  nombre_agente: string | null;
  identificacion_agente: string | null;
  motivo_ingreso_crv: string | null;
  clase: string | null;
  provincia: string | null;
  localidad_ciudad: string | null;
  ciudadela: string | null;
  area: string | null;
  direccion: string | null;
  remolque: string | null;
  km_remolque: string | null;
  valor_remolque: string | null;
  fecha_generacion: string | null;
  fecha_ingreso: string | null;
  fecha_salida: string | null;
  localidad_ciudad_catalogo_item_id: number | null;
  provincia_catalogo_item_id: number | null;
}

export interface CrvListResponse {
  items: CrvItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface CrvFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
