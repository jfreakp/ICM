import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { CrvComponent, COLUMNAS } from './crv.component';
import { AuthService } from '../../../core/auth.service';
import { CrvService } from '../../../core/crv.service';
import { CrvItem, CrvListResponse } from '../../../core/models/crv.model';

describe('CrvComponent', () => {
  let fixture: ComponentFixture<CrvComponent>;
  let crvService: {
    listCrv: ReturnType<typeof vi.fn>;
    exportCrv: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
  };

  const item: CrvItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '08:45:00',
    codigo_orden_crv: 'ORD-001',
    codigo_actividad: 'ING',
    codigo_oficina: 'OF-01',
    descripcion_oficina: 'Oficina Centro',
    placa: 'ABC1234',
    nombre_agente: 'Agente de Prueba',
    identificacion_agente: '1103456789',
    motivo_ingreso_crv: 'INFRACCION',
    clase: 'LIVIANO',
    provincia: 'LOJ',
    localidad_ciudad: 'LOJA',
    ciudadela: 'CENTRO',
    area: 'URBANA',
    direccion: 'Av. de Prueba',
    remolque: 'GRUA-01',
    km_remolque: '5.2',
    valor_remolque: '15.00',
    fecha_generacion: '2031-06-05',
    fecha_ingreso: '2031-06-05',
    fecha_salida: null,
    localidad_ciudad_catalogo_item_id: 8,
    provincia_catalogo_item_id: 4,
  };

  const resultado: CrvListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    crvService = {
      listCrv: vi.fn().mockReturnValue(of(resultado)),
      exportCrv: vi.fn().mockReturnValue(of(new Blob(['data']))),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
    };

    await TestBed.configureTestingModule({
      imports: [CrvComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: CrvService, useValue: crvService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CrvComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(crvService.listCrv).toHaveBeenCalledWith(
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
    it('renders results once the deferred response arrives, with all 24 columns in the defined order', async () => {
      const resultado$ = new Subject<CrvListResponse>();
      crvService.listCrv.mockReturnValue(resultado$);

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
      expect(headerTexts.length).toBe(24);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(24);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[17]).toBe('5.2');
      expect(cellTexts[22]).toBe('8');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<CrvListResponse>();
      crvService.listCrv.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay registros de CRV para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<CrvListResponse>();
      crvService.listCrv.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar los registros de CRV. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    crvService.listCrv.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(crvService.listCrv).toHaveBeenLastCalledWith(
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

      expect(crvService.exportCrv).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      crvService.listCrv.mockReturnValue(
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
    crvService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(CrvComponent);
    fixtureConFecha.detectChanges();

    expect(crvService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
});
