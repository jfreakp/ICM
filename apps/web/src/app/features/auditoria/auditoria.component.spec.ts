import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { AuditoriaComponent } from './auditoria.component';
import { AuthService } from '../../core/auth.service';
import { AuditoriaService } from '../../core/auditoria.service';
import { AuditLogListResponse } from '../../core/models/audit-log.model';

describe('AuditoriaComponent', () => {
  let fixture: ComponentFixture<AuditoriaComponent>;
  let auditoriaService: { listEventos: ReturnType<typeof vi.fn> };

  const respuesta: AuditLogListResponse = {
    items: [
      {
        id: 1,
        occurred_at: '2026-08-12T10:00:00Z',
        user_id: 5,
        user_email: 'ana@icmloja.gob.ec',
        action: 'auth.login_success',
        ip_address: '10.0.0.5',
        details: {},
      },
    ],
    total: 1,
    page: 1,
    page_size: 50,
  };

  beforeEach(async () => {
    auditoriaService = { listEventos: vi.fn().mockReturnValue(of(respuesta)) };

    await TestBed.configureTestingModule({
      imports: [AuditoriaComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: AuditoriaService, useValue: auditoriaService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AuditoriaComponent);
    fixture.detectChanges();
  });

  it('renders the page title', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Auditoría');
  });

  it('loads the first page with empty filters on init', () => {
    expect(auditoriaService.listEventos).toHaveBeenCalledWith(
      { desde: null, hasta: null, accion: null, usuarioEmail: null },
      1
    );
  });

  it('renders events fetched from AuditoriaService', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('ana@icmloja.gob.ec');
    expect(text).toContain('Inicio de sesión exitoso');
  });

  it('renders occurred_at converted to Ecuador local time instead of the raw UTC string', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    // '2026-08-12T10:00:00Z' (UTC) is 05:00 local time (UTC-5).
    expect(text).toContain('12/08/2026 05:00:00');
    expect(text).not.toContain('2026-08-12T10:00:00Z');
  });

  it('submits the current filters and reloads page 1', () => {
    fixture.componentInstance.form.setValue({
      desde: '2026-08-01',
      hasta: '2026-08-31',
      accion: 'auth.logout',
      usuarioEmail: 'ana@icmloja.gob.ec',
    });

    fixture.componentInstance.buscar();

    expect(auditoriaService.listEventos).toHaveBeenCalledWith(
      { desde: '2026-08-01', hasta: '2026-08-31', accion: 'auth.logout', usuarioEmail: 'ana@icmloja.gob.ec' },
      1
    );
  });

  it('requests the next page when cambiarPagina is called', () => {
    fixture.componentInstance.cambiarPagina(2);

    expect(auditoriaService.listEventos).toHaveBeenCalledWith(
      { desde: null, hasta: null, accion: null, usuarioEmail: null },
      2
    );
  });

  describe('async rendering under zoneless change detection', () => {
    it('renders the table once the deferred response arrives', async () => {
      const resultado$ = new Subject<AuditLogListResponse>();
      auditoriaService.listEventos.mockReturnValue(resultado$);

      const localFixture = TestBed.createComponent(AuditoriaComponent);
      localFixture.detectChanges();

      expect((localFixture.nativeElement as HTMLElement).textContent ?? '').not.toContain('ana@icmloja.gob.ec');

      resultado$.next(respuesta);
      await localFixture.whenStable();

      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('ana@icmloja.gob.ec');
    });

    it('shows an error message when listEventos fails with 403', async () => {
      const resultado$ = new Subject<AuditLogListResponse>();
      auditoriaService.listEventos.mockReturnValue(resultado$);

      const localFixture = TestBed.createComponent(AuditoriaComponent);
      localFixture.detectChanges();

      resultado$.error(new HttpErrorResponse({ status: 403 }));
      await localFixture.whenStable();

      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No tienes permisos para ver esta página.');
    });

    it('clears a previously rendered table when a reload fails', async () => {
      const primera$ = new Subject<AuditLogListResponse>();
      auditoriaService.listEventos.mockReturnValue(primera$);

      const localFixture = TestBed.createComponent(AuditoriaComponent);
      localFixture.detectChanges();
      primera$.next(respuesta);
      await localFixture.whenStable();

      expect((localFixture.nativeElement as HTMLElement).textContent ?? '').toContain('ana@icmloja.gob.ec');

      const segunda$ = new Subject<AuditLogListResponse>();
      auditoriaService.listEventos.mockReturnValue(segunda$);
      localFixture.componentInstance.cambiarPagina(2);
      segunda$.error(new HttpErrorResponse({ status: 500 }));
      await localFixture.whenStable();

      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('ana@icmloja.gob.ec');
      expect(text).toContain('No se pudieron cargar los eventos de auditoría. Intenta de nuevo.');
    });

    it('shows the empty state message when there are no results', async () => {
      const vacio: AuditLogListResponse = { items: [], total: 0, page: 1, page_size: 50 };
      const resultado$ = new Subject<AuditLogListResponse>();
      auditoriaService.listEventos.mockReturnValue(resultado$);

      const localFixture = TestBed.createComponent(AuditoriaComponent);
      localFixture.detectChanges();

      resultado$.next(vacio);
      await localFixture.whenStable();

      const text = (localFixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay eventos para estos filtros');
    });
  });
});
