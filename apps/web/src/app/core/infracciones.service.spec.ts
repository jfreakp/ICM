import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { InfraccionesService } from './infracciones.service';
import { InfraccionListResponse } from './models/infraccion.model';
import { environment } from '../../environments/environment';

describe('InfraccionesService', () => {
  let service: InfraccionesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [InfraccionesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(InfraccionesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getEstados fetches the list of distinct estados', () => {
    let result: string[] | undefined;
    service.getEstados().subscribe((estados) => (result = estados));

    const req = httpMock.expectOne(`${environment.apiUrl}/reportes/infracciones/estados`);
    expect(req.request.method).toBe('GET');
    req.flush(['EMITIDA', 'PAGADA']);

    expect(result).toEqual(['EMITIDA', 'PAGADA']);
  });

  it('listInfracciones sends fecha_desde, fecha_hasta, page and omits estado when not set', () => {
    const response: InfraccionListResponse = { items: [], total: 0, page: 1, page_size: 50 };
    service
      .listInfracciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null }, 1)
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/infracciones`);
    expect(req.request.params.get('fecha_desde')).toBe('2024-06-01');
    expect(req.request.params.get('fecha_hasta')).toBe('2024-06-30');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.has('estado')).toBe(false);
    req.flush(response);
  });

  it('listInfracciones includes estado when set', () => {
    service
      .listInfracciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: 'PAGADA' }, 2)
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/infracciones`);
    expect(req.request.params.get('estado')).toBe('PAGADA');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, page_size: 50 });
  });

  it('exportInfracciones requests a blob with the formato param', () => {
    let result: Blob | undefined;
    service
      .exportInfracciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null }, 'xlsx')
      .subscribe((blob) => (result = blob));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/reportes/infracciones/export`
    );
    expect(req.request.params.get('formato')).toBe('xlsx');
    expect(req.request.responseType).toBe('blob');
    const blob = new Blob(['data']);
    req.flush(blob);

    expect(result).toBe(blob);
  });
});
