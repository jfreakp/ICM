import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { ModificacionInfraccionesComponent, COLUMNAS } from './modificacion-infracciones.component';
import { AuthService } from '../../../core/auth.service';
import { ModificacionInfraccionesService } from '../../../core/modificacion-infracciones.service';
import {
  ModificacionInfraccionItem,
  ModificacionInfraccionListResponse,
} from '../../../core/models/modificacion-infraccion.model';

describe('ModificacionInfraccionesComponent', () => {
  let fixture: ComponentFixture<ModificacionInfraccionesComponent>;
  let modificacionInfraccionesService: {
    listModificacionInfracciones: ReturnType<typeof vi.fn>;
    exportModificacionInfracciones: ReturnType<typeof vi.fn>;
  };

  const item: ModificacionInfraccionItem = {
    id: 1,
    registro: 'REG-001',
    hora_generacion: '11:20:00',
    codigo_infraccion_original: 'ORIG-001',
    contravencion: 'CONT-001',
    observacion: 'Observación de prueba',
    codigo_infraccion_acta: 'ACTA-001',
    codigo_usuario_modifica: 'USR-MOD-01',
    numero_credito: 'CRED-001',
    fecha_generacion: '2031-06-05',
    fecha_registro: '2031-06-05',
  };

  const resultado: ModificacionInfraccionListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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
    modificacionInfraccionesService = {
      listModificacionInfracciones: vi.fn().mockReturnValue(of(resultado)),
      exportModificacionInfracciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [ModificacionInfraccionesComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: ModificacionInfraccionesService, useValue: modificacionInfraccionesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ModificacionInfraccionesComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2031-06-15', '2031-07-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(modificacionInfraccionesService.listModificacionInfracciones).toHaveBeenCalledWith(
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
    it('renders results once the deferred response arrives, with all 10 columns in the defined order', async () => {
      const resultado$ = new Subject<ModificacionInfraccionListResponse>();
      modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(resultado$);

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
      expect(headerTexts.length).toBe(10);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(10);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[5]).toBe('ACTA-001');
      expect(cellTexts[9]).toBe('2031-06-05');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<ModificacionInfraccionListResponse>();
      modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay modificaciones de infracciones para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<ModificacionInfraccionListResponse>();
      modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(resultado$);

      fillForm('2031-06-01', '2031-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar las modificaciones de infracciones. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(of({ ...resultado, total: 60 }));

    fillForm('2031-06-01', '2031-06-30');
    submitForm();

    const siguienteButton: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="pagina-siguiente"]'
    );
    expect(siguienteButton.disabled).toBe(false);
    siguienteButton.click();

    expect(modificacionInfraccionesService.listModificacionInfracciones).toHaveBeenLastCalledWith(
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

      expect(modificacionInfraccionesService.exportModificacionInfracciones).toHaveBeenCalledWith(
        { fecha_desde: '2031-06-01', fecha_hasta: '2031-06-30' },
        'csv'
      );
    });

    it('disables the download buttons when there are no results', () => {
      modificacionInfraccionesService.listModificacionInfracciones.mockReturnValue(
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
