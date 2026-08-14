export interface ResumenTablaItem {
  tabla: string;
  etiqueta: string;
  total: number;
}

export interface DashboardResumenResponse {
  tablas: ResumenTablaItem[];
}
