import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { JuicioFilters, JuicioListResponse } from './models/juicio.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: JuicioFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class JuiciosService {
  private readonly http = inject(HttpClient);

  listJuicios(filters: JuicioFilters, page: number): Observable<JuicioListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<JuicioListResponse>(`${environment.apiUrl}/reportes/juicios`, { params });
  }

  exportJuicios(filters: JuicioFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/juicios/export`, {
      params,
      responseType: 'blob',
    });
  }
}
