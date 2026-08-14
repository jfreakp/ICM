import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { DashboardService } from './dashboard.service';
import { DashboardResumenResponse } from './models/dashboard-resumen.model';
import { environment } from '../../environments/environment';

describe('DashboardService', () => {
  let service: DashboardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [DashboardService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(DashboardService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('fetches the dashboard summary', () => {
    const resumen: DashboardResumenResponse = {
      tablas: [{ tabla: 'crv', etiqueta: 'CRV', total: 16 }],
    };

    service.getResumen().subscribe((res) => expect(res).toEqual(resumen));

    const req = httpMock.expectOne(`${environment.apiUrl}/dashboard/resumen`);
    expect(req.request.method).toBe('GET');
    req.flush(resumen);
  });
});
