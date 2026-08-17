import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ModificacionInfraccionFilters, ModificacionInfraccionListResponse } from './models/modificacion-infraccion.model';
import { FechaMinimaResponse } from './models/fecha-minima.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: ModificacionInfraccionFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class ModificacionInfraccionesService {
  private readonly http = inject(HttpClient);

  getFechaMinima(): Observable<FechaMinimaResponse> {
    return this.http.get<FechaMinimaResponse>(`${environment.apiUrl}/reportes/modificacion-infracciones/fecha-minima`);
  }

  listModificacionInfracciones(
    filters: ModificacionInfraccionFilters,
    page: number
  ): Observable<ModificacionInfraccionListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<ModificacionInfraccionListResponse>(
      `${environment.apiUrl}/reportes/modificacion-infracciones`,
      { params }
    );
  }

  exportModificacionInfracciones(
    filters: ModificacionInfraccionFilters,
    formato: 'csv' | 'xlsx'
  ): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/modificacion-infracciones/export`, {
      params,
      responseType: 'blob',
    });
  }
}
