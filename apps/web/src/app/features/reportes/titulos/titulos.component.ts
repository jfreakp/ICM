import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { TitulosService } from '../../../core/titulos.service';
import { TituloFilters, TituloItem, TituloListResponse } from '../../../core/models/titulo.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los títulos de crédito. Intenta de nuevo.';

export interface ColumnaTitulo {
  clave: keyof TituloItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaTitulo[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'codigo_titulo_credito', encabezado: 'Código Título Crédito' },
  { clave: 'tipo_identificacion', encabezado: 'Tipo de Identificación' },
  { clave: 'identificacion', encabezado: 'Identificación' },
  { clave: 'nombre_completo', encabezado: 'Nombre Completo' },
  { clave: 'etapa_cobranza', encabezado: 'Etapa Cobranza' },
  { clave: 'estado', encabezado: 'Estado' },
  { clave: 'codigo_referencia', encabezado: 'Código de Referencia' },
  { clave: 'concepto', encabezado: 'Concepto' },
  { clave: 'nombre_elabora_titulo', encabezado: 'Nombre Elabora Título de Crédito' },
  { clave: 'nombre_solicita', encabezado: 'Nombre que Solicita' },
  { clave: 'nombre_aprobacion', encabezado: 'Nombre de Aprobación' },
  { clave: 'motivo_anulacion', encabezado: 'Motivo de Anulación' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
  { clave: 'fecha_elaboracion', encabezado: 'Fecha de Elaboración' },
  { clave: 'fecha_solicitud', encabezado: 'Fecha de Solicitud' },
  { clave: 'fecha_aprobacion', encabezado: 'Fecha de Aprobación' },
  { clave: 'fecha_notificacion', encabezado: 'Fecha de Notificación' },
  { clave: 'fecha_pago', encabezado: 'Fecha de Pago' },
  { clave: 'fecha_anulacion', encabezado: 'Fecha de Anulación' },
  { clave: 'valor', encabezado: 'Valor' },
  { clave: 'multas', encabezado: 'Multas' },
  { clave: 'interes', encabezado: 'Interés' },
  { clave: 'valor_total', encabezado: 'Valor Total' },
  { clave: 'estado_catalogo_item_id', encabezado: 'ID de Catálogo (Estado)' },
  { clave: 'etapa_cobranza_catalogo_item_id', encabezado: 'ID de Catálogo (Etapa de Cobranza)' },
  { clave: 'tipo_identificacion_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación)' },
];

@Component({
  selector: 'app-titulos',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './titulos.component.html',
})
export class TitulosComponent {
  private readonly titulosService = inject(TitulosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<TituloListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: TituloFilters | null = null;

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
    const { fechaDesde, fechaHasta } = this.form.getRawValue();
    if (!this.rangoValido(fechaDesde, fechaHasta)) {
      return;
    }
    this.filtrosVigentes = { fecha_desde: fechaDesde, fecha_hasta: fechaHasta };
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
    this.titulosService.exportTitulos(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: TituloFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `titulos_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.titulosService.listTitulos(this.filtrosVigentes, page).subscribe({
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
