export interface PagoItem {
  id: number;
  registro: string | null;
  hora_generacion: string | null;
  tipo_recaudador: string | null;
  recaudador: string | null;
  comprobante_pago_interno: string | null;
  comprobante_pago_recaudador: string | null;
  tipo_servicio: string | null;
  tipo_documento: string | null;
  numero_documento: string | null;
  fecha_generacion: string | null;
  fecha_operacion: string | null;
  fecha_transaccion: string | null;
  monto_recaudado: number | null;
  monto_cuenta_1: number | null;
  monto_cuenta_2: number | null;
}

export interface PagoListResponse {
  items: PagoItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface PagoFilters {
  fecha_desde: string;
  fecha_hasta: string;
}
