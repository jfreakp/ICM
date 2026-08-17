import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { JuiciosService } from '../../../core/juicios.service';
import { JuicioFilters, JuicioItem, JuicioListResponse } from '../../../core/models/juicio.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los juicios. Intenta de nuevo.';

export interface ColumnaJuicio {
  clave: keyof JuicioItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaJuicio[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'codigo', encabezado: 'Código' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación' },
  { clave: 'tipo_identificacion', encabezado: 'Tipo de Identificación' },
  { clave: 'identificacion', encabezado: 'Identificación' },
  { clave: 'nombre_completo', encabezado: 'Nombre Completo' },
  { clave: 'gestor_responsable', encabezado: 'Gestor Responsable' },
  { clave: 'gestor_secretario', encabezado: 'Gestor Secretario' },
  { clave: 'gestor_anulacion', encabezado: 'Gestor de Anulación' },
  { clave: 'gestor_suspension', encabezado: 'Gestor de Suspensión' },
  { clave: 'gestor_reactivacion', encabezado: 'Gestor de Reactivación' },
  { clave: 'motivo_anulacion', encabezado: 'Motivo de Anulación' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
  { clave: 'fecha_inicio_juicio', encabezado: 'Fecha de Inicio de Juicio' },
  { clave: 'fecha_notificacion', encabezado: 'Fecha de Notificación' },
  { clave: 'fecha_pago', encabezado: 'Fecha de Pago' },
  { clave: 'fecha_fin', encabezado: 'Fecha de Fin' },
  { clave: 'fecha_anulacion', encabezado: 'Fecha de Anulación' },
  { clave: 'fecha_suspension', encabezado: 'Fecha de Suspensión' },
  { clave: 'fecha_reactivacion', encabezado: 'Fecha de Reactivación' },
  { clave: 'valor_capital', encabezado: 'Valor Capital' },
  { clave: 'valor_interes', encabezado: 'Valor Interés' },
  { clave: 'valor_multas', encabezado: 'Valor Multas' },
  { clave: 'valor_costas', encabezado: 'Valor Costas' },
  { clave: 'valor_total', encabezado: 'Valor Total' },
  { clave: 'tipo_identificacion_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Identificación)' },
];

@Component({
  selector: 'app-juicios',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './juicios.component.html',
})
export class JuiciosComponent implements OnInit {
  private readonly juiciosService = inject(JuiciosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<JuicioListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: JuicioFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.juiciosService.getFechaMinima().subscribe({
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
    this.juiciosService.exportJuicios(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: JuicioFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `juicios_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.juiciosService.listJuicios(this.filtrosVigentes, page).subscribe({
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
