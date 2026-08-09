import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ImpugnacionFilters, ImpugnacionListResponse } from './models/impugnacion.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: ImpugnacionFilters): HttpParams {
  let params = new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
  if (filters.estado) {
    params = params.set('estado', filters.estado);
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class ImpugnacionesService {
  private readonly http = inject(HttpClient);

  getEstados(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/reportes/impugnaciones/estados`);
  }

  listImpugnaciones(filters: ImpugnacionFilters, page: number): Observable<ImpugnacionListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<ImpugnacionListResponse>(`${environment.apiUrl}/reportes/impugnaciones`, {
      params,
    });
  }

  exportImpugnaciones(filters: ImpugnacionFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/impugnaciones/export`, {
      params,
      responseType: 'blob',
    });
  }
}
