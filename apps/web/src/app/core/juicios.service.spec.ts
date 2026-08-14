import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { JuiciosService } from './juicios.service';
import { JuicioFilters, JuicioListResponse } from './models/juicio.model';
import { environment } from '../../environments/environment';

describe('JuiciosService', () => {
  let service: JuiciosService;
  let httpMock: HttpTestingController;

  const filters: JuicioFilters = { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [JuiciosService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(JuiciosService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists juicios with fecha_desde, fecha_hasta and page params', () => {
    const resultado: JuicioListResponse = { items: [], total: 0, page: 1, page_size: 50 };

    service.listJuicios(filters, 1).subscribe((res) => expect(res).toEqual(resultado));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/reportes/juicios`
    );
    expect(req.request.params.get('fecha_desde')).toBe('2031-06-01');
    expect(req.request.params.get('fecha_hasta')).toBe('2031-06-30');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(resultado);
  });

  it('exports juicios as a blob with the formato param', () => {
    const blob = new Blob(['data']);

    service.exportJuicios(filters, 'xlsx').subscribe((res) => expect(res).toEqual(blob));

    const req = httpMock.expectOne(
      (r) => r.url === `${environment.apiUrl}/reportes/juicios/export`
    );
    expect(req.request.params.get('formato')).toBe('xlsx');
    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });
});
