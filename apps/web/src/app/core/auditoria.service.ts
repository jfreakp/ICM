import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuditLogFilters, AuditLogListResponse } from './models/audit-log.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: AuditLogFilters): HttpParams {
  let params = new HttpParams();
  if (filters.desde) params = params.set('desde', filters.desde);
  if (filters.hasta) params = params.set('hasta', filters.hasta);
  if (filters.accion) params = params.set('accion', filters.accion);
  if (filters.usuarioEmail) params = params.set('usuario_email', filters.usuarioEmail);
  return params;
}

@Injectable({ providedIn: 'root' })
export class AuditoriaService {
  private readonly http = inject(HttpClient);

  listEventos(filters: AuditLogFilters, page: number): Observable<AuditLogListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<AuditLogListResponse>(`${environment.apiUrl}/auditoria`, { params });
  }
}
