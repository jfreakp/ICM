import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { JuiciosComponent, COLUMNAS } from './juicios.component';
import { AuthService } from '../../../core/auth.service';
import { JuiciosService } from '../../../core/juicios.service';
import { JuicioItem, JuicioListResponse } from '../../../core/models/juicio.model';

describe('JuiciosComponent', () => {
  let fixture: ComponentFixture<JuiciosComponent>;
  let juiciosService: {
    listJuicios: ReturnType<typeof vi.fn>;
    exportJuicios: ReturnType<typeof vi.fn>;
  };

  const item: JuicioItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '10:30:00',
    codigo: 'COD-001',
    tipo_identificacion: 'CED',
    identificacion: '1103456789',
    nombre_completo: 'Deudor de Prueba',
    gestor_responsable: 'Gestor Responsable',
    gestor_secretario: 'Gestor Secretario',
    gestor_anulacion: null,
    gestor_suspension: null,
    gestor_reactivacion: null,
    motivo_anulacion: null,
    fecha_generacion: '2031-06-05',
    fecha_registro: '2031-06-05',
    fecha_inicio_juicio: '2031-06-05',
    fecha_notificacion: '2031-06-05',
    fecha_pago: null,
    fecha_fin: null,
    fecha_anulacion: null,
    fecha_suspension: null,
    fecha_reactivacion: null,
    valor_capital: 40,
    valor_interes: 0.48,
    valor_multas: 40,
    valor_costas: 30.63,
    valor_total: 80.48,
    deleted_at: null,
    tipo_identificacion_catalogo_item_id: 67,
  };

  const resultado: JuicioListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    juiciosService = {
      listJuicios: vi.fn().mockReturnValue(of(resultado)),
      exportJuicios: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [JuiciosComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: JuiciosService, useValue: juiciosService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(JuiciosComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(juiciosService.listJuicios).toHaveBeenCalledWith(
      { fecha_desde: '2031-06-15', fecha_hasta: '2031-07-05' },
      1
    );
  });

  it('blocks submit when fecha desde is after fecha hasta', () => {
    fillForm('2031-06-20', '2031-06-10');

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('La fecha desde no puede ser posterior a la fecha hasta.');
  });

  describe('async rendering under zoneless change detection', () => {
    it('renders results once the deferred response arrives, with all 28 columns in the defined order', async () => {
      const resultado$ = new Subject<JuicioListResponse>();
      juiciosService.listJuicios.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      expect((fixture.nativeElement as HTMLElement).textContent ?? '').toContain('Cargando...');
      expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(0);

      resultado$.next(resultado);
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).not.toContain('Cargando...');
      expect(text).toContain('REG-001');
      expect(fixture.nativeElement.querySelectorAll('tbody tr').length).toBe(1);

      const headerCells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll('thead th');
      const headerTexts = Array.from(headerCells).map((th) => th.textContent?.trim());
      expect(headerTexts).toEqual(COLUMNAS.map((c) => c.encabezado));
      expect(headerTexts.length).toBe(28);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(28);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[25]).toBe('80.48');
      expect(cellTexts[27]).toBe('67');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<JuicioListResponse>();
      juiciosService.listJuicios.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay juicios para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<JuicioListResponse>();
      juiciosService.listJuicios.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar los juicios. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    juiciosService.listJuicios.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(juiciosService.listJuicios).toHaveBeenLastCalledWith(
      { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
      2
    );
  });

  describe('descargas', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
      URL.revokeObjectURL = vi.fn();
    });

    it('descarga CSV con los filtros vigentes', () => {
      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      const csvButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-csv"]');
      csvButton.click();

      expect(juiciosService.exportJuicios).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      juiciosService.listJuicios.mockReturnValue(
        of({ items: [], total: 0, page: 1, page_size: 50 })
      );

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      const csvButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-csv"]');
      const excelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-excel"]');
      expect(csvButton.disabled).toBe(true);
      expect(excelButton.disabled).toBe(true);
    });
  });
});
