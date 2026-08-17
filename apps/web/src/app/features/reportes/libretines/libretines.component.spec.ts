import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { LibretinesComponent, COLUMNAS } from './libretines.component';
import { AuthService } from '../../../core/auth.service';
import { LibretinesService } from '../../../core/libretines.service';
import { LibretinItem, LibretinListResponse } from '../../../core/models/libretin.model';

describe('LibretinesComponent', () => {
  let fixture: ComponentFixture<LibretinesComponent>;
  let libretinesService: {
    listLibretines: ReturnType<typeof vi.fn>;
    exportLibretines: ReturnType<typeof vi.fn>;
  };

  const item: LibretinItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '07:30:00',
    codigo_libretin: 'LIB-001',
    prefijo_boleta: 'A',
    rango_inicio_boleta: '000001',
    rango_fin_boleta: '000100',
    cantidad_boletas: '100',
    longitud_boleta: '6',
    estado: 'ACTIVO',
    codigo_tramite: 'TRA-001',
    codigo_usuario_creacion: 'USR-001',
    codigo_tramite_asignacion: 'TRA-002',
    codigo_usuario_asignacion: 'USR-002',
    codigo_usuario_inactiva: null,
    observacion: 'Observación de prueba',
    codigo_agente: 'AGT-001',
    identificacion_agente: '1103456789',
    agente: 'Agente de Prueba',
    codigo_distrito: 'D-01',
    descripcion_distrito: 'Distrito Centro',
    codigo_oficina: 'OF-01',
    descripcion_oficina: 'Oficina Centro',
    codigo_provincia: 'LOJ',
    descripcion_provincia: 'Loja',
    codigo_localidad: 'LOJ-01',
    descripcion_localidad: 'Loja',
    tipo: 'NORMAL',
    origen_tramite: 'MANUAL',
    motivo_baja: null,
    disponibles: '50',
    utilizadas: '40',
    desactivadas: '10',
    fecha_generacion: '2031-06-05',
    fecha_registro: '2031-06-05',
    fecha_asignacion: null,
    fecha_inactivacion: null,
    codigo_localidad_catalogo_item_id: 8,
    codigo_provincia_catalogo_item_id: 4,
    estado_catalogo_item_id: 2,
    tipo_catalogo_item_id: 1,
  };

  const resultado: LibretinListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    libretinesService = {
      listLibretines: vi.fn().mockReturnValue(of(resultado)),
      exportLibretines: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [LibretinesComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: LibretinesService, useValue: libretinesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LibretinesComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(libretinesService.listLibretines).toHaveBeenCalledWith(
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
    it('renders results once the deferred response arrives, with all 40 columns in the defined order', async () => {
      const resultado$ = new Subject<LibretinListResponse>();
      libretinesService.listLibretines.mockReturnValue(resultado$);

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
      expect(headerTexts.length).toBe(40);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(40);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[29]).toBe('50');
      expect(cellTexts[38]).toBe('2');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<LibretinListResponse>();
      libretinesService.listLibretines.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay libretines para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<LibretinListResponse>();
      libretinesService.listLibretines.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar los libretines. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    libretinesService.listLibretines.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(libretinesService.listLibretines).toHaveBeenLastCalledWith(
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

      expect(libretinesService.exportLibretines).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      libretinesService.listLibretines.mockReturnValue(
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
