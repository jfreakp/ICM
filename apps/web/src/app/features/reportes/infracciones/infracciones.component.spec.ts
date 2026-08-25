import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { provideRouter } from '@angular/router';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { InfraccionesComponent, COLUMNAS } from './infracciones.component';
import { AuthService } from '../../../core/auth.service';
import { InfraccionesService } from '../../../core/infracciones.service';
import { InfraccionItem, InfraccionListResponse } from '../../../core/models/infraccion.model';

describe('InfraccionesComponent', () => {
  let fixture: ComponentFixture<InfraccionesComponent>;
  let infraccionesService: {
    getEstados: ReturnType<typeof vi.fn>;
    getFechaMinima: ReturnType<typeof vi.fn>;
    listInfracciones: ReturnType<typeof vi.fn>;
    exportInfracciones: ReturnType<typeof vi.fn>;
  };

  const item: InfraccionItem = {
    id: 1,
    registro: 'REG-001',
    fecha_registro: '2024-06-05T00:00:00',
    fecha_emision: '2024-06-05T00:00:00',
    fecha_aprobacion: '2024-06-05T00:00:00',
    fecha_vencimiento: '2024-06-15T00:00:00',
    estado: 'EMITIDA',
    codigo_infraccion: 'COD-001',
    codigo_infraccion_ant: 'ANT-001',
    contravencion: 'CONTRA-001',
    articulo: '139',
    literal: '1',
    descripcion_articulo: 'Descripción de prueba',
    periodo_fiscal: 'ACTUAL',
    oficina: 'GAD LOJA',
    origen_registro: 'AXIS',
    tipo_registro_infraccion: 'PARTE',
    tipo_emision: 'ACT',
    tipo_deudor: 'CONDUCTOR',
    codigo_usuario_registra: 'USR001',
    observacion: 'Observación de prueba',
    provincia: 'LOJ',
    localidad: 'LOJ',
    lugar_infraccion: 'Av. de prueba',
    canal: 'APP',
    placa: 'ABC1234',
    tipo_identificacion_infractor: 'CED',
    numero_identificacion_infractor: '1103456789',
    nombre_infractor: 'Infractor de Prueba',
    tipo_identificacion_propietario: 'CED',
    numero_identificacion_propietario: '1103456789',
    nombre_propietario: 'Propietario de Prueba',
    indicador_bloqueada: 'N',
    indicador_acta_juzgamiento: 'N',
    indicador_modificada: 'N',
    indicador_calcula_recargo: 'S',
    valor_capital: 50,
    valor_capital_exonerado: 0,
    valor_recargo: 5,
    valor_recargo_exonerado: 0,
    valor_intereses: 1,
    valor_total: 56,
    hora_generacion: '14:35:00',
    fecha_generacion: '2024-06-01',
    tipo_infraccion: null,
    codigo_usuario_aprueba: null,
    codigo_usuario_notifica: null,
    tipo_licencia: null,
    zona: null,
    distrito: null,
    circuito: null,
    dispositivo: null,
    geo_referencia_x: null,
    geo_referencia_y: null,
    tipo_identificacion_agente: null,
    numero_identificacion_agente: null,
    nombre_agente: null,
    codigo_agente_transito: null,
    tipo_infraccion_2: null,
    codigo_infraccion_origen: null,
    codigo_empresa_convenio: null,
    porcentaje_principal: null,
    porcentaje_convenio: null,
    cuenta_bancaria_principal: null,
    cuenta_bancaria_convenio: null,
    fecha_notificacion: null,
    fecha_pago: null,
    fecha_impugnacion: null,
    fecha_convenio: null,
    fecha_anulacion: null,
    fecha_coactiva: null,
    canal_catalogo_item_id: null,
    estado_catalogo_item_id: null,
    localidad_catalogo_item_id: null,
    origen_registro_catalogo_item_id: null,
    provincia_catalogo_item_id: null,
    tipo_deudor_catalogo_item_id: null,
    tipo_emision_catalogo_item_id: null,
    tipo_identificacion_agente_catalogo_item_id: null,
    tipo_identificacion_infractor_catalogo_item_id: null,
    tipo_identificacion_propietario_catalogo_item_id: null,
    tipo_licencia_catalogo_item_id: null,
    tipo_registro_infraccion_catalogo_item_id: null,
    zona_catalogo_item_id: null,
  };

  const resultado: InfraccionListResponse = { items: [item], total: 1, page: 1, page_size: 50 };

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

  function fillContravencion(codigo: string): void {
    const contravencionInput: HTMLInputElement = fixture.nativeElement.querySelector('#contravencion');
    contravencionInput.value = codigo;
    contravencionInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  function submitForm(): void {
    const form: HTMLFormElement = fixture.nativeElement.querySelector('form');
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  beforeEach(async () => {
    infraccionesService = {
      getEstados: vi.fn().mockReturnValue(of(['EMITIDA', 'PAGADA'])),
      getFechaMinima: vi.fn().mockReturnValue(of({ fecha_minima: null })),
      listInfracciones: vi.fn().mockReturnValue(of(resultado)),
      exportInfracciones: vi.fn().mockReturnValue(of(new Blob(['data']))),
    };

    await TestBed.configureTestingModule({
      imports: [InfraccionesComponent, ReactiveFormsModule],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) } },
        { provide: InfraccionesService, useValue: infraccionesService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InfraccionesComponent);
    fixture.detectChanges();
  });

  it('allows submit and requests page 1 when the range crosses a month boundary', () => {
    fillForm('2024-03-15', '2024-04-05');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(infraccionesService.listInfracciones).toHaveBeenCalledWith(
      { fecha_desde: '2024-03-15', fecha_hasta: '2024-04-05', estado: null, contravencion: null },
      1
    );
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

    expect(infraccionesService.listInfracciones).toHaveBeenCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null, contravencion: null },
      1
    );
  });

  it('sends the contravencion code when the field is filled in', () => {
    fillForm('2024-06-01', '2024-06-30');
    fillContravencion('LEVE-B');

    submitForm();

    expect(infraccionesService.listInfracciones).toHaveBeenCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null, contravencion: 'LEVE-B' },
      1
    );
  });

  it('disables submit when no filter is filled in', () => {
    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(true);
  });

  it('disables submit when only one of the two dates is filled in, even with no contravencion', () => {
    const desdeInput: HTMLInputElement = fixture.nativeElement.querySelector('#fecha-desde');
    desdeInput.value = '2024-06-01';
    desdeInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(true);
  });

  it('allows submit with only the contravencion code, without any dates', () => {
    fillContravencion('LEVE-B');

    const submitButton: HTMLButtonElement = fixture.nativeElement.querySelector('button[type="submit"]');
    expect(submitButton.disabled).toBe(false);

    submitForm();

    expect(infraccionesService.listInfracciones).toHaveBeenCalledWith(
      { fecha_desde: null, fecha_hasta: null, estado: null, contravencion: 'LEVE-B' },
      1
    );
  });

  describe('async rendering under zoneless change detection', () => {
    it('renders results once the deferred response arrives, with all 83 columns in the defined order', async () => {
      const resultado$ = new Subject<InfraccionListResponse>();
      infraccionesService.listInfracciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
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
      expect(headerTexts.length).toBe(83);

      const cells: NodeListOf<HTMLElement> = fixture.nativeElement.querySelectorAll(
        'tbody tr:first-child td'
      );
      const cellTexts = Array.from(cells).map((td) => td.textContent?.trim());
      expect(cellTexts.length).toBe(83);
      expect(cellTexts[0]).toBe('REG-001');
      expect(cellTexts[6]).toBe('COD-001');
      expect(cellTexts[40]).toBe('56');
    });

    it('shows the empty state message when there are no results', async () => {
      const resultado$ = new Subject<InfraccionListResponse>();
      infraccionesService.listInfracciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      resultado$.next({ items: [], total: 0, page: 1, page_size: 50 });
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No hay infracciones para estos filtros');
    });

    it('shows an error message when the request fails', async () => {
      const resultado$ = new Subject<InfraccionListResponse>();
      infraccionesService.listInfracciones.mockReturnValue(resultado$);

      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      resultado$.error(new Error('500'));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudieron cargar las infracciones. Intenta de nuevo.');
    });
  });

  it('cambiarPagina requests the next page using the current filters', () => {
    infraccionesService.listInfracciones.mockReturnValue(of({ ...resultado, total: 60 }));

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

    expect(infraccionesService.listInfracciones).toHaveBeenLastCalledWith(
      { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null, contravencion: null },
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

      expect(infraccionesService.exportInfracciones).toHaveBeenCalledWith(
        { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null, contravencion: null },
        'csv'
      );
    });

    it('descarga Excel con los filtros vigentes', () => {
      fillForm('2024-06-01', '2024-06-30');
      submitForm();

      const excelButton: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="descargar-excel"]');
      excelButton.click();

      expect(infraccionesService.exportInfracciones).toHaveBeenCalledWith(
        { fecha_desde: '2024-06-01', fecha_hasta: '2024-06-30', estado: null, contravencion: null },
        'xlsx'
      );
    });

    it('disables the download buttons when there are no results', () => {
      infraccionesService.listInfracciones.mockReturnValue(
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

  it('shows the formatted minimum date under the title on init', () => {
    infraccionesService.getFechaMinima.mockReturnValue(of({ fecha_minima: '2020-01-05' }));

    const fixtureConFecha = TestBed.createComponent(InfraccionesComponent);
    fixtureConFecha.detectChanges();

    expect(infraccionesService.getFechaMinima).toHaveBeenCalled();
    const text = (fixtureConFecha.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Información disponible desde: 05/01/2020');
  });

  it('shows nothing when there is no minimum date', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).not.toContain('Información disponible desde');
  });
});
