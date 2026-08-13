export interface AuditLogItem {
  id: number;
  occurred_at: string;
  user_id: number | null;
  user_email: string;
  action: string;
  ip_address: string | null;
  details: Record<string, unknown> | null;
}

export interface AuditLogListResponse {
  items: AuditLogItem[];
  total: number;
  page: number;
  page_size: number;
}

export interface AuditLogFilters {
  desde: string | null;
  hasta: string | null;
  accion: string | null;
  usuarioEmail: string | null;
}
