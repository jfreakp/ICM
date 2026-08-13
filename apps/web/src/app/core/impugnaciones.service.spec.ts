import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { ImpugnacionesService } from './impugnaciones.service';
import { ImpugnacionListResponse } from './models/impugnacion.model';
import { environment } from '../../environments/environment';

describe('ImpugnacionesService', () => {
  let service: ImpugnacionesService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [ImpugnacionesService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(ImpugnacionesService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('getEstados fetches the list of distinct estados', () => {
    let result: string[] | undefined;
    service.getEstados().subscribe((estados) => (result = estados));

    const req = httpMock.expectOne(`${environment.apiUrl}/reportes/impugnaciones/estados`);
    expect(req.request.method).toBe('GET');
    req.flush(['A', 'B']);

    expect(result).toEqual(['A', 'B']);
  });

  it('listImpugnaciones sends fecha_desde, fecha_hasta, page and omits estado when not set', () => {
    const response: ImpugnacionListResponse = { items: [], total: 0, page: 1, page_size: 50 };
    service
      .listImpugnaciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null }, 1)
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/impugnaciones`);
    expect(req.request.params.get('fecha_desde')).toBe('2024-06-01');
    expect(req.request.params.get('fecha_hasta')).toBe('2024-06-30');
    expect(req.request.params.get('page')).toBe('1');
    expect(req.request.params.has('estado')).toBe(false);
    req.flush(response);
  });

  it('listImpugnaciones includes estado when set', () => {
    service
      .listImpugnaciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: 'A' }, 2)
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/impugnaciones`);
    expect(req.request.params.get('estado')).toBe('A');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, page_size: 50 });
  });

  it('exportImpugnaciones requests a blob with the formato param', () => {
    let result: Blob | undefined;
    service
      .exportImpugnaciones({ fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null }, 'xlsx')
      .subscribe((blob) => (result = blob));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/reportes/impugnaciones/export`
    );
    expect(req.request.params.get('formato')).toBe('xlsx');
    expect(req.request.responseType).toBe('blob');
    const blob = new Blob(['data']);
    req.flush(blob);

    expect(result).toBe(blob);
  });
});
