import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { ModificacionInfraccionesService } from '../../../core/modificacion-infracciones.service';
import {
  ModificacionInfraccionFilters,
  ModificacionInfraccionItem,
  ModificacionInfraccionListResponse,
} from '../../../core/models/modificacion-infraccion.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar las modificaciones de infracciones. Intenta de nuevo.';

export interface ColumnaModificacionInfraccion {
  clave: keyof ModificacionInfraccionItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaModificacionInfraccion[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'codigo_infraccion_original', encabezado: 'Código de la Infracción (Original)' },
  { clave: 'contravencion', encabezado: 'Contravención' },
  { clave: 'observacion', encabezado: 'Observación' },
  { clave: 'codigo_infraccion_acta', encabezado: 'Código de la Infracción (Acta)' },
  { clave: 'codigo_usuario_modifica', encabezado: 'Código de Usuario que Modifica' },
  { clave: 'numero_credito', encabezado: 'Número de Crédito' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
];

@Component({
  selector: 'app-modificacion-infracciones',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './modificacion-infracciones.component.html',
})
export class ModificacionInfraccionesComponent implements OnInit {
  private readonly modificacionInfraccionesService = inject(ModificacionInfraccionesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<ModificacionInfraccionListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: ModificacionInfraccionFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.modificacionInfraccionesService.getFechaMinima().subscribe({
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
    this.modificacionInfraccionesService.exportModificacionInfracciones(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: ModificacionInfraccionFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `modificacion-infracciones_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.modificacionInfraccionesService.listModificacionInfracciones(this.filtrosVigentes, page).subscribe({
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
