import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CrvFilters, CrvListResponse } from './models/crv.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: CrvFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class CrvService {
  private readonly http = inject(HttpClient);

  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/crv/fecha-minima`);
  }

  listCrv(filters: CrvFilters, page: number): Observable<CrvListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<CrvListResponse>(`${environment.apiUrl}/reportes/crv`, { params });
  }

  exportCrv(filters: CrvFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/crv/export`, {
      params,
      responseType: 'blob',
    });
  }
}
