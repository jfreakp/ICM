import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { PagosService } from './pagos.service';
import { PagoFilters, PagoListResponse } from './models/pago.model';
import { environment } from '../../environments/environment';

describe('PagosService', () => {
  let service: PagosService;
  let httpMock: HttpTestingController;

  const filters: PagoFilters = { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PagosService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PagosService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('lists pagos with fecha_desde, fecha_hasta and page params', () => {
    const resultado: PagoListResponse = { items: [], total: 0, page: 1, page_size: 50 };

    service.listPagos(filters, 1).subscribe((res) => expect(res).toEqual(resultado));

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/pagos`);
    expect(req.request.params.get('fecha_desde')).toBe('2031-06-01');
    expect(req.request.params.get('fecha_hasta')).toBe('2031-06-30');
    expect(req.request.params.get('page')).toBe('1');
    req.flush(resultado);
  });

  it('exports pagos as a blob with the formato param', () => {
    const blob = new Blob(['data']);

    service.exportPagos(filters, 'xlsx').subscribe((res) => expect(res).toEqual(blob));

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/reportes/pagos/export`);
    expect(req.request.params.get('formato')).toBe('xlsx');
    expect(req.request.responseType).toBe('blob');
    req.flush(blob);
  });
});
