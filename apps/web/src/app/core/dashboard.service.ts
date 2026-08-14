import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { DashboardResumenResponse } from './models/dashboard-resumen.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class DashboardService {
  private readonly http = inject(HttpClient);

  getResumen(): Observable<DashboardResumenResponse> {
    return this.http.get<DashboardResumenResponse>(`${environment.apiUrl}/dashboard/resumen`);
  }
}
