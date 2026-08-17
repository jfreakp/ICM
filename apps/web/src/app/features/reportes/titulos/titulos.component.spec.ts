import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { TitulosComponent, COLUMNAS } from './titulos.component';
import { AuthService } from '../../../core/auth.service';
import { TitulosService } from '../../../core/titulos.service';
import { TituloItem, TituloListResponse } from '../../../core/models/titulo.model';

describe('TitulosComponent', () => {
  let fixture: ComponentFixture<TitulosComponent>;
  let titulosService: {
    listTitulos: ReturnType<typeof vi.fn>;
    exportTitulos: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
  };

  const item: TituloItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '09:15:00',
    codigo_titulo_credito: 'TC-001',
    tipo_identificacion: 'CED',
    identificacion: '1103456789',
    nombre_completo: 'Deudor de Prueba',
    etapa_cobranza: 'NOTIFICACION',
    estado: 'ACTIVO',
    codigo_referencia: 'REF-001',
    concepto: 'Concepto de prueba',
    nombre_elabora_titulo: 'Elaborador de Prueba',
    nombre_solicita: 'Solicitante de Prueba',
    nombre_aprobacion: 'Aprobador de Prueba',
    motivo_anulacion: null,
    fecha_generacion: '2031-06-05',
    fecha_registro: '2031-06-05',
    fecha_elaboracion: '2031-06-05',
    fecha_solicitud: '2031-06-05',
    fecha_aprobacion: null,
    fecha_notificacion: null,
    fecha_pago: null,
    fecha_anulacion: null,
    valor: 150,
    multas: 10,
    interes: 2.5,
    valor_total: 162.5,
    estado_catalogo_item_id: 12,
    etapa_cobranza_catalogo_item_id: 5,
    tipo_identificacion_catalogo_item_id: 3,
  };

  const resultado: TituloListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    titulosService = {
      listTitulos: vi.fn().mockReturnValue(of(resultado)),
      exportTitulos: vi.fn().mockReturnValue(of(new Blob(['data']))),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
    };

    await TestBed.configureTestingModule({
      imports: [TitulosComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: TitulosService, useValue: titulosService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TitulosComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(titulosService.listTitulos).toHaveBeenCalledWith(
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
    it('renders results once the deferred response arrives, with all 29 columns in the defined order', async () => {
      const resultado$ = new Subject<TituloListResponse>();
      titulosService.listTitulos.mockReturnValue(resultado$);

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
      expect(headerTexts.length).toBe(29);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(29);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[25]).toBe('162.5');
      expect(cellTexts[26]).toBe('12');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<TituloListResponse>();
      titulosService.listTitulos.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay títulos de crédito para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<TituloListResponse>();
      titulosService.listTitulos.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar los títulos de crédito. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    titulosService.listTitulos.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(titulosService.listTitulos).toHaveBeenLastCalledWith(
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

      expect(titulosService.exportTitulos).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      titulosService.listTitulos.mockReturnValue(
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

  it('shows the formatted minimum date under the title on init', () => {
    titulosService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(TitulosComponent);
    fixtureConFecha.detectChanges();

    expect(titulosService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
});
