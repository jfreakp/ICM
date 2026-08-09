import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { ImpugnacionesComponent } from './impugnaciones.component';
import { AuthService } from '../../../core/auth.service';
import { ImpugnacionesService } from '../../../core/impugnaciones.service';
import { ImpugnacionListResponse } from '../../../core/models/impugnacion.model';

describe('ImpugnacionesComponent', () => {
  let fixture: ComponentFixture<ImpugnacionesComponent>;
  let impugnacionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    listImpugnaciones: ReturnType<typeof vi.fn>;
    exportImpugnaciones: ReturnType<typeof vi.fn>;
  };

  const resultado: ImpugnacionListResponse = {
    items: [
      {
        id: 1,
        registro: 'REG-1',
        fecha_registro: '2024-06-10T00:00:00',
        fecha_acta: '2024-06-09T00:00:00',
        estado: 'A',
        codigo_infraccion_axis: 'COD-1',
        contravencion: 'Contravencion 1',
        tipo_acta: 'Tipo 1',
        articulo_original: 'Art 1',
        monto_capital_original: 100,
        observacion: 'Obs 1',
      },
    ],
    total: 1,
    page: 1,
    page_size: 50,
  };

  function fillForm(fechaDesde: string, fechaHasta: string): void {
    const desdeInput: HTMLInputElement = fixture.nativeElement.querySelector('#fecha-desde');
    const hastaInput: HTMLInputElement = fixture.nativeElement.querySelector('#fecha-hasta');
    desdeInput.value = fechaDesde;
    desdeInput.dispatchEvent(new Event('input'));
    desdeInput.dispatchEvent(new Event('change'));
    hastaInput.value = fechaHasta;
    hastaInput.dispatchEvent(new Event('input'));
    hastaInput.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function submitForm(): void {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    impugnacionesService = {
      getEstados: vi.fn().mockReturnValue(of(['A', 'B'])),
      listImpugnaciones: vi.fn().mockReturnValue(of(resultado)),
      exportImpugnaciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [ImpugnacionesComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: ImpugnacionesService, useValue: impugnacionesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ImpugnacionesComponent);
    fixture.detectChanges();
  });

  it('blocks submit when the date range crosses a month boundary', () => {
    fillForm('2024-03-15', '2024-04-05');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('El rango de fechas debe estar dentro del mismo mes calendario.');
    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(true);
  });

  it('blocks submit when fecha desde is after fecha hasta in the same month', () => {
    fillForm('2024-03-20', '2024-03-10');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('La fecha desde no puede ser posterior a la fecha hasta.');
  });

  it('allows submit and requests page 1 when the range is within the same month', () => {
    fillForm('2024-06-01', '2024-06-30');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(impugnacionesService.listImpugnaciones).toHaveBeenCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
      1
    );
  });

  describe('async rendering under zoneless change detection', () => {
    it('renders results once the deferred response arrives', async () => {
      const resultado$ = new Subject<ImpugnacionListResponse>();
      impugnacionesService.listImpugnaciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain('Cargando...');
      expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(0);

      resultado$.next(resultado);
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Cargando...');
      expect(text).toContain('REG-1');
      expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<ImpugnacionListResponse>();
      impugnacionesService.listImpugnaciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay impugnaciones para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<ImpugnacionListResponse>();
      impugnacionesService.listImpugnaciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar las impugnaciones. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    impugnacionesService.listImpugnaciones.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2024-06-01', '2024-06-30');
    submitForm();

    const anteriorButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-anterior"]'
    );
    expect(anteriorButton.disabled).toBe(true);

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(impugnacionesService.listImpugnaciones).toHaveBeenLastCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
      2
    );
  });

  describe('descargas', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      URL.revokeObjectURL = vi.fn();
    });

    it('descarga CSV con los filtros vigentes', () => {
      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      const csvButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-csv"]');
      csvButton.click();

      expect(impugnacionesService.exportImpugnaciones).toHaveBeenCalledWith(
        { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
        'csv'
      );
    });

    it('descarga Excel con los filtros vigentes', () => {
      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      const excelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-excel"]');
      excelButton.click();

      expect(impugnacionesService.exportImpugnaciones).toHaveBeenCalledWith(
        { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null },
        'xlsx'
      );
    });

    it('disables the download buttons when there are no results', () => {
      impugnacionesService.listImpugnaciones.mockReturnValue(
        of({ items: [], total: 0, page: 1, page_size: 50 })
      );

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      const csvButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-csv"]');
      const excelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-excel"]');
      expect(csvButton.disabled).toBe(true);
      expect(excelButton.disabled).toBe(true);
    });
  });
});
