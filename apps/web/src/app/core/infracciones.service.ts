import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { InfraccionFilters, InfraccionListResponse } from './models/infraccion.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: InfraccionFilters): HttpParams {
  let params = new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
  if (filters.estado) {
    params = params.set('estado', filters.estado);
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class InfraccionesService {
  private readonly http = inject(HttpClient);

  getEstados(): Observable<string[]> {
    return this.http.get<string[]>(`${environment.apiUrl}/reportes/infracciones/estados`);
  }

  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/infracciones/fecha-minima`);
  }

  listInfracciones(filters: InfraccionFilters, page: number): Observable<InfraccionListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<InfraccionListResponse>(`${environment.apiUrl}/reportes/infracciones`, {
      params,
    });
  }

  exportInfracciones(filters: InfraccionFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/infracciones/export`, {
      params,
      responseType: 'blob',
    });
  }
}
