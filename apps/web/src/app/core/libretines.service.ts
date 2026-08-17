import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { LibretinFilters, LibretinListResponse } from './models/libretin.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: LibretinFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class LibretinesService {
  private readonly http = inject(HttpClient);

  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/libretines/fecha-minima`);
  }

  listLibretines(filters: LibretinFilters, page: number): Observable<LibretinListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<LibretinListResponse>(`${environment.apiUrl}/reportes/libretines`, { params });
  }

  exportLibretines(filters: LibretinFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/libretines/export`, {
      params,
      responseType: 'blob',
    });
  }
}
