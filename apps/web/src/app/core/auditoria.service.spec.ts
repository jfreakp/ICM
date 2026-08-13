import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuditoriaService } from './auditoria.service';
import { AuditLogListResponse } from './models/audit-log.model';
import { environment } from '../../environments/environment';

describe('AuditoriaService', () => {
  let service: AuditoriaService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [AuditoriaService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuditoriaService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listEventos omits optional filters when not set', () => {
    const response: AuditLogListResponse = { items: [], total: 0, page: 1, page_size: 50 };
    service.listEventos({ desde: null, hasta: null, accion: null, usuarioEmail: null }, 1).subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/auditoria`);
    expect(req.request.params.has('desde')).toBe(false);
    expect(req.request.params.has('hasta')).toBe(false);
    expect(req.request.params.has('accion')).toBe(false);
    expect(req.request.params.has('usuario_email')).toBe(false);
    expect(req.request.params.get('page')).toBe('1');
    req.flush(response);
  });

  it('listEventos includes all filters when set', () => {
    service
      .listEventos(
        { desde: '2026-08-01', hasta: '2026-08-31', accion: 'auth.login_success', usuarioEmail: 'a@b.com' },
        2
      )
      .subscribe();

    const req = httpMock.expectOne((r) => r.url === `${environment.apiUrl}/auditoria`);
    expect(req.request.params.get('desde')).toBe('2026-08-01');
    expect(req.request.params.get('hasta')).toBe('2026-08-31');
    expect(req.request.params.get('accion')).toBe('auth.login_success');
    expect(req.request.params.get('usuario_email')).toBe('a@b.com');
    expect(req.request.params.get('page')).toBe('2');
    req.flush({ items: [], total: 0, page: 2, page_size: 50 });
  });
});
