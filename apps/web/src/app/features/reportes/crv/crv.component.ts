import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { CrvService } from '../../../core/crv.service';
import { CrvFilters, CrvItem, CrvListResponse } from '../../../core/models/crv.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los registros de CRV. Intenta de nuevo.';

export interface ColumnaCrv {
  clave: keyof CrvItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaCrv[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación del Registro' },
  { clave: 'codigo_orden_crv', encabezado: 'Código de Orden CRV' },
  { clave: 'codigo_actividad', encabezado: 'Código de Actividad' },
  { clave: 'codigo_oficina', encabezado: 'Código de Oficina' },
  { clave: 'descripcion_oficina', encabezado: 'Descripción de Oficina' },
  { clave: 'placa', encabezado: 'Placa' },
  { clave: 'nombre_agente', encabezado: 'Nombre Agente' },
  { clave: 'identificacion_agente', encabezado: 'Identificación de Agente' },
  { clave: 'motivo_ingreso_crv', encabezado: 'Motivo Ingreso al CRV' },
  { clave: 'clase', encabezado: 'Clase' },
  { clave: 'provincia', encabezado: 'Provincia' },
  { clave: 'localidad_ciudad', encabezado: 'Localidad o Ciudad' },
  { clave: 'ciudadela', encabezado: 'Ciudadela' },
  { clave: 'area', encabezado: 'Área' },
  { clave: 'direccion', encabezado: 'Dirección' },
  { clave: 'remolque', encabezado: 'Remolque' },
  { clave: 'km_remolque', encabezado: 'Km de Remolque' },
  { clave: 'valor_remolque', encabezado: 'Valor Remolque' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación del Registro' },
  { clave: 'fecha_ingreso', encabezado: 'Fecha Ingreso' },
  { clave: 'fecha_salida', encabezado: 'Fecha Salida' },
  { clave: 'localidad_ciudad_catalogo_item_id', encabezado: 'ID de Catálogo (Localidad o Ciudad)' },
  { clave: 'provincia_catalogo_item_id', encabezado: 'ID de Catálogo (Provincia)' },
];

@Component({
  selector: 'app-crv',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './crv.component.html',
})
export class CrvComponent implements OnInit {
  private readonly crvService = inject(CrvService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<CrvListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: CrvFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.crvService.getFechaMinima().subscribe({
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
    this.crvService.exportCrv(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: CrvFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `crv_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.crvService.listCrv(this.filtrosVigentes, page).subscribe({
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
