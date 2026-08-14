import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PagoFilters, PagoListResponse } from './models/pago.model';
import { environment } from '../../environments/environment';

function buildFilterParams(filters: PagoFilters): HttpParams {
  return new HttpParams()
    .set('fecha_desde', filters.fecha_desde)
    .set('fecha_hasta', filters.fecha_hasta);
}

@Injectable({ providedIn: 'root' })
export class PagosService {
  private readonly http = inject(HttpClient);

  listPagos(filters: PagoFilters, page: number): Observable<PagoListResponse> {
    const params = buildFilterParams(filters).set('page', page.toString());
    return this.http.get<PagoListResponse>(`${environment.apiUrl}/reportes/pagos`, { params });
  }

  exportPagos(filters: PagoFilters, formato: 'csv' | 'xlsx'): Observable<Blob> {
    const params = buildFilterParams(filters).set('formato', formato);
    return this.http.get(`${environment.apiUrl}/reportes/pagos/export`, {
      params,
      responseType: 'blob',
    });
  }
}
