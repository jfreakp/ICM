import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, ValidatorFn } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { InfraccionesService } from '../../../core/infracciones.service';
import { InfraccionFilters, InfraccionItem, InfraccionListResponse } from '../../../core/models/infraccion.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar las infracciones. Intenta de nuevo.';

const requiereRangoOContravencion: ValidatorFn = (control: AbstractControl): ValidationErrors | null => {
  const { fechaDesde, fechaHasta, contravencion } = control.value as {
    fechaDesde: string;
    fechaHasta: string;
    contravencion: string;
  };
  if (!!fechaDesde !== !!fechaHasta) {
    return { fechaIncompleta: true };
  }
  if (!fechaDesde && !contravencion) {
    return { filtroRequerido: true };
  }
  return null;
};

export interface ColumnaInfraccion {
  clave: keyof InfraccionItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaInfraccion[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
  { clave: 'fecha_emision', encabezado: 'Fecha de Emisión' },
  { clave: 'fecha_aprobacion', encabezado: 'Fecha de Aprobación' },
  { clave: 'fecha_vencimiento', encabezado: 'Fecha de Vencimiento' },
  { clave: 'estado', encabezado: 'Estado' },
  { clave: 'codigo_infraccion', encabezado: 'Código de Infracción' },
  { clave: 'codigo_infraccion_ant', encabezado: 'Código de Infracción Anterior' },
  { clave: 'contravencion', encabezado: 'Contravención' },
  { clave: 'articulo', encabezado: 'Artículo' },
  { clave: 'literal', encabezado: 'Literal' },
  { clave: 'descripcion_articulo', encabezado: 'Descripción del Artículo' },
  { clave: 'periodo_fiscal', encabezado: 'Período Fiscal' },
  { clave: 'oficina', encabezado: 'Oficina' },
  { clave: 'origen_registro', encabezado: 'Origen de Registro' },
  { clave: 'tipo_registro_infraccion', encabezado: 'Tipo de Registro' },
  { clave: 'tipo_emision', encabezado: 'Tipo de Emisión' },
  { clave: 'tipo_deudor', encabezado: 'Tipo de Deudor' },
  { clave: 'codigo_usuario_registra', encabezado: 'Usuario que Registra' },
  { clave: 'observacion', encabezado: 'Observación' },
  { clave: 'provincia', encabezado: 'Provincia' },
  { clave: 'localidad', encabezado: 'Localidad' },
  { clave: 'lugar_infraccion', encabezado: 'Lugar de Infracción' },
  { clave: 'canal', encabezado: 'Canal' },
  { clave: 'placa', encabezado: 'Placa' },
  { clave: 'tipo_identificacion_infractor', encabezado: 'Tipo de Identificación (Infractor)' },
  { clave: 'numero_identificacion_infractor', encabezado: 'Número de Identificación (Infractor)' },
  { clave: 'nombre_infractor', encabezado: 'Nombre del Infractor' },
  { clave: 'tipo_identificacion_propietario', encabezado: 'Tipo de Identificación (Propietario)' },
  { clave: 'numero_identificacion_propietario', encabezado: 'Número de Identificación (Propietario)' },
  { clave: 'nombre_propietario', encabezado: 'Nombre del Propietario' },
  { clave: 'indicador_bloqueada', encabezado: 'Bloqueada' },
  { clave: 'indicador_acta_juzgamiento', encabezado: 'Acta de Juzgamiento' },
  { clave: 'indicador_modificada', encabezado: 'Modificada' },
  { clave: 'indicador_calcula_recargo', encabezado: 'Calcula Recargo' },
  { clave: 'valor_capital', encabezado: 'Valor Capital' },
  { clave: 'valor_capital_exonerado', encabezado: 'Valor Capital Exonerado' },
  { clave: 'valor_recargo', encabezado: 'Valor Recargo' },
  { clave: 'valor_recargo_exonerado', encabezado: 'Valor Recargo Exonerado' },
  { clave: 'valor_intereses', encabezado: 'Valor Intereses' },
  { clave: 'valor_total', encabezado: 'Valor Total' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'tipo_infraccion', encabezado: 'Tipo de Infracción' },
  { clave: 'codigo_usuario_aprueba', encabezado: 'Código del Usuario que Aprueba' },
  { clave: 'codigo_usuario_notifica', encabezado: 'Código del Usuario que Notifica' },
  { clave: 'tipo_licencia', encabezado: 'Tipo de Licencia' },
  { clave: 'zona', encabezado: 'Zona' },
  { clave: 'distrito', encabezado: 'Distrito' },
  { clave: 'circuito', encabezado: 'Circuito' },
  { clave: 'dispositivo', encabezado: 'Dispositivo' },
  { clave: 'geo_referencia_x', encabezado: 'Geo-referencia-X' },
  { clave: 'geo_referencia_y', encabezado: 'Geo-referencia-Y' },
  { clave: 'tipo_identificacion_agente', encabezado: 'Tipo de Identificación del Agente' },
  { clave: 'numero_identificacion_agente', encabezado: 'Número de Identificación del Agente' },
  { clave: 'nombre_agente', encabezado: 'Nombre del Agente' },
  { clave: 'codigo_agente_transito', encabezado: 'Código del Agente de Tránsito' },
  { clave: 'tipo_infraccion_2', encabezado: 'Tipo de Infracción (2)' },
  { clave: 'codigo_infraccion_origen', encabezado: 'Código de la Infracción Origen' },
  { clave: 'codigo_empresa_convenio', encabezado: 'Código de la Empresa del Convenio' },
  { clave: 'porcentaje_principal', encabezado: 'Porcentaje Principal' },
  { clave: 'porcentaje_convenio', encabezado: 'Porcentaje Convenio' },
  { clave: 'cuenta_bancaria_principal', encabezado: 'Cuenta Bancaria Principal' },
  { clave: 'cuenta_bancaria_convenio', encabezado: 'Cuenta Bancaria Convenio' },
  { clave: 'fecha_notificacion', encabezado: 'Fecha de Notificación' },
  { clave: 'fecha_pago', encabezado: 'Fecha de Pago' },
  { clave: 'fecha_impugnacion', encabezado: 'Fecha de Impugnación' },
  { clave: 'fecha_convenio', encabezado: 'Fecha de Convenio' },
  { clave: 'fecha_anulacion', encabezado: 'Fecha de Anulación' },
  { clave: 'fecha_coactiva', encabezado: 'Fecha de Coactiva' },
  { clave: 'canal_catalogo_item_id', encabezado: 'ID de Catálogo (Canal)' },
  { clave: 'estado_catalogo_item_id', encabezado: 'ID de Catálogo (Estado)' },
  { clave: 'localidad_catalogo_item_id', encabezado: 'ID de Catálogo (Localidad)' },
  { clave: 'origen_registro_catalogo_item_id', encabezado: 'ID de Catálogo (Origen de Registro)' },
  { clave: 'provincia_catalogo_item_id', encabezado: 'ID de Catálogo (Provincia)' },
  { clave: 'tipo_deudor_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Deudor)' },
  { clave: 'tipo_emision_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Emisión)' },
  { clave: 'tipo_identificacion_agente_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación del Agente)' },
  { clave: 'tipo_identificacion_infractor_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación del Infractor)' },
  { clave: 'tipo_identificacion_propietario_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación del Propietario)' },
  { clave: 'tipo_licencia_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Licencia)' },
  { clave: 'tipo_registro_infraccion_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Registro de Infracción)' },
  { clave: 'zona_catalogo_item_id', encabezado: 'ID de Catálogo (Zona)' },
];

@Component({
  selector: 'app-infracciones',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './infracciones.component.html',
})
export class InfraccionesComponent implements OnInit {
  private readonly infraccionesService = inject(InfraccionesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group(
    {
      fechaDesde: [''],
      fechaHasta: [''],
      estado: [''],
      contravencion: [''],
    },
    { validators: requiereRangoOContravencion }
  );

  private readonly estadosSubject = new BehaviorSubject<string[]>([]);
  readonly estados$ = this.estadosSubject.asObservable();

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  private readonly resultadoSubject = new BehaviorSubject<InfraccionListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: InfraccionFilters | null = null;

  ngOnInit(): void {
    this.infraccionesService.getEstados().subscribe({
      next: (estados) => this.estadosSubject.next(estados),
      error: () => this.errorSubject.next(LOAD_ERROR_MESSAGE),
    });
    this.infraccionesService.getFechaMinima().subscribe({
      next: (respuesta) => this.fechaMinimaSubject.next(this.formatearFecha(respuesta.fecha_minima)),
      error: () => {},
    });
  }

  private formatearFecha(fechaIso: string | null): string | null {
    if (!fechaIso) {
      return null;
    }
    const [anio, mes, dia] = fechaIso.split('-');
    return `${dia}/${mes}/${anio}`;
  }

  onFechaChange(): void {
    const { fechaDesde, fechaHasta } = this.form.getRawValue();
    if (fechaDesde && fechaHasta) {
      this.rangoValido(fechaDesde, fechaHasta);
    } else {
      this.rangeErrorSubject.next(null);
    }
  }

  private rangoValido(fechaDesde: string, fechaHasta: string): boolean {
    const desde = new Date(fechaDesde);
    const hasta = new Date(fechaHasta);
    if (desde.getTime() > hasta.getTime()) {
      this.rangeErrorSubject.next(ORDER_ERROR_MESSAGE);
      return false;
    }
    this.rangeErrorSubject.next(null);
    return true;
  }

  buscar(): void {
    if (this.form.invalid) {
      return;
    }
    const { fechaDesde, fechaHasta, estado, contravencion } = this.form.getRawValue();
    if (fechaDesde && fechaHasta && !this.rangoValido(fechaDesde, fechaHasta)) {
      return;
    }
    this.filtrosVigentes = {
      fecha_desde: fechaDesde || null,
      fecha_hasta: fechaHasta || null,
      estado: estado || null,
      contravencion: contravencion || null,
    };
    this.cargarPagina(1);
  }

  cambiarPagina(page: number): void {
    this.cargarPagina(page);
  }

  descargar(formato: 'csv' | 'xlsx'): void {
    if (!this.filtrosVigentes) {
      return;
    }
    const filtros = this.filtrosVigentes;
    this.infraccionesService.exportInfracciones(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: InfraccionFilters, formato: 'csv' | 'xlsx'): void {
    const filename =
      filtros.fecha_desde && filtros.fecha_hasta
        ? `infracciones_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`
        : `infracciones_${filtros.contravencion}.${formato}`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  private cargarPagina(page: number): void {
    if (!this.filtrosVigentes) {
      return;
    }
    this.loadingSubject.next(true);
    this.errorSubject.next(null);
    this.infraccionesService.listInfracciones(this.filtrosVigentes, page).subscribe({
      next: (resultado) => {
        this.resultadoSubject.next(resultado);
        this.loadingSubject.next(false);
      },
      error: () => {
        this.errorSubject.next(LOAD_ERROR_MESSAGE);
        this.loadingSubject.next(false);
      },
    });
  }
}
