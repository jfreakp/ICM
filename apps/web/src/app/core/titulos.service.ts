import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TituloFilters, TituloListResponse } from './models/titulo.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: TituloFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class TitulosService {
  private readonly http = inject(HttpClient);

  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/titulos/fecha-minima`);
  }

  listTitulos(filters: TituloFilters, page: number): Observable<TituloListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<TituloListResponse>(`${environment.apiUrl}/reportes/titulos`, { params });
  }

  exportTitulos(filters: TituloFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/titulos/export`, {
      params,
      responseType: 'blob',
    });
  }
}
