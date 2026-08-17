import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { LibretinesService } from '../../../core/libretines.service';
import { LibretinFilters, LibretinItem, LibretinListResponse } from '../../../core/models/libretin.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los libretines. Intenta de nuevo.';

export interface ColumnaLibretin {
  clave: keyof LibretinItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaLibretin[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'codigo_libretin', encabezado: 'Código Libretin' },
  { clave: 'prefijo_boleta', encabezado: 'Prefijo Boleta' },
  { clave: 'rango_inicio_boleta', encabezado: 'Rango Inicio Boleta' },
  { clave: 'rango_fin_boleta', encabezado: 'Rango Fin Boleta' },
  { clave: 'cantidad_boletas', encabezado: 'Cantidad Boletas' },
  { clave: 'longitud_boleta', encabezado: 'Longitud Boleta' },
  { clave: 'estado', encabezado: 'Estado' },
  { clave: 'codigo_tramite', encabezado: 'Código de Trámite' },
  { clave: 'codigo_usuario_creacion', encabezado: 'Código de Usuario Creación' },
  { clave: 'codigo_tramite_asignacion', encabezado: 'Código de Trámite Asignación' },
  { clave: 'codigo_usuario_asignacion', encabezado: 'Código de Usuario Asignación' },
  { clave: 'codigo_usuario_inactiva', encabezado: 'Código de Usuario Inactiva' },
  { clave: 'observacion', encabezado: 'Observación' },
  { clave: 'codigo_agente', encabezado: 'Código Agente' },
  { clave: 'identificacion_agente', encabezado: 'Identificación Agente' },
  { clave: 'agente', encabezado: 'Agente' },
  { clave: 'codigo_distrito', encabezado: 'Código Distrito' },
  { clave: 'descripcion_distrito', encabezado: 'Descripción Distrito' },
  { clave: 'codigo_oficina', encabezado: 'Código Oficina' },
  { clave: 'descripcion_oficina', encabezado: 'Descripción Oficina' },
  { clave: 'codigo_provincia', encabezado: 'Código Provincia' },
  { clave: 'descripcion_provincia', encabezado: 'Descripción Provincia' },
  { clave: 'codigo_localidad', encabezado: 'Código Localidad' },
  { clave: 'descripcion_localidad', encabezado: 'Descripción Localidad' },
  { clave: 'tipo', encabezado: 'Tipo' },
  { clave: 'origen_tramite', encabezado: 'Origen Trámite' },
  { clave: 'motivo_baja', encabezado: 'Motivo Baja' },
  { clave: 'disponibles', encabezado: 'Disponibles' },
  { clave: 'utilizadas', encabezado: 'Utilizadas' },
  { clave: 'desactivadas', encabezado: 'Desactivadas' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'fecha_registro', encabezado: 'Fecha de Registro' },
  { clave: 'fecha_asignacion', encabezado: 'Fecha Asignación' },
  { clave: 'fecha_inactivacion', encabezado: 'Fecha Inactivación' },
  { clave: 'codigo_localidad_catalogo_item_id', encabezado: 'ID de Catálogo (Localidad)' },
  { clave: 'codigo_provincia_catalogo_item_id', encabezado: 'ID de Catálogo (Provincia)' },
  { clave: 'estado_catalogo_item_id', encabezado: 'ID de Catálogo (Estado)' },
  { clave: 'tipo_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo)' },
];

@Component({
  selector: 'app-libretines',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './libretines.component.html',
})
export class LibretinesComponent {
  private readonly libretinesService = inject(LibretinesService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<LibretinListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: LibretinFilters | null = null;

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
    this.libretinesService.exportLibretines(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: LibretinFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `libretines_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.libretinesService.listLibretines(this.filtrosVigentes, page).subscribe({
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
