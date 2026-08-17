import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../../shared/app-shell/app-shell.component';
import { PagosService } from '../../../core/pagos.service';
import { PagoFilters, PagoItem, PagoListResponse } from '../../../core/models/pago.model';

const ORDER_ERROR_MESSAGE = 'La fecha desde no puede ser posterior a la fecha hasta.';
const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los pagos. Intenta de nuevo.';

export interface ColumnaPago {
  clave: keyof PagoItem;
  encabezado: string;
}

export const COLUMNAS: ColumnaPago[] = [
  { clave: 'registro', encabezado: 'Registro' },
  { clave: 'hora_generacion', encabezado: 'Hora de Generación' },
  { clave: 'tipo_recaudador', encabezado: 'Tipo de Recaudador' },
  { clave: 'recaudador', encabezado: 'Recaudador' },
  { clave: 'comprobante_pago_interno', encabezado: 'Comprobante de Pago Interno' },
  { clave: 'comprobante_pago_recaudador', encabezado: 'Comprobante de Pago del Recaudador' },
  { clave: 'tipo_servicio', encabezado: 'Tipo de Servicio' },
  { clave: 'tipo_documento', encabezado: 'Tipo de Documento' },
  { clave: 'numero_documento', encabezado: 'Número de Documento' },
  { clave: 'fecha_generacion', encabezado: 'Fecha de Generación' },
  { clave: 'fecha_operacion', encabezado: 'Fecha de Operación' },
  { clave: 'fecha_transaccion', encabezado: 'Fecha de Transacción' },
  { clave: 'monto_recaudado', encabezado: 'Monto Recaudado' },
  { clave: 'monto_cuenta_1', encabezado: 'Monto Cuenta 1' },
  { clave: 'monto_cuenta_2', encabezado: 'Monto Cuenta 2' },
  { clave: 'tipo_documento_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Documento)' },
  { clave: 'tipo_recaudador_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Recaudador)' },
  { clave: 'tipo_servicio_catalogo_item_id', encabezado: 'ID de Catálogo (Tipo de Servicio)' },
];

@Component({
  selector: 'app-pagos',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './pagos.component.html',
})
export class PagosComponent implements OnInit {
  private readonly pagosService = inject(PagosService);
  private readonly fb = inject(FormBuilder);

  readonly columnas = COLUMNAS;

  readonly form = this.fb.nonNullable.group({
    fechaDesde: ['', Validators.required],
    fechaHasta: ['', Validators.required],
  });

  private readonly resultadoSubject = new BehaviorSubject<PagoListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private readonly rangeErrorSubject = new BehaviorSubject<string | null>(null);
  readonly rangeError$ = this.rangeErrorSubject.asObservable();

  private filtrosVigentes: PagoFilters | null = null;

  private readonly fechaMinimaSubject = new BehaviorSubject<string | null>(null);
  readonly fechaMinima$ = this.fechaMinimaSubject.asObservable();

  ngOnInit(): void {
    this.pagosService.getFechaMinima().subscribe({
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
    this.pagosService.exportPagos(filtros, formato).subscribe({
      next: (blob) => this.disparaDescarga(blob, filtros, formato),
      error: () => this.errorSubject.next('No se pudo descargar el archivo. Intenta de nuevo.'),
    });
  }

  private disparaDescarga(blob: Blob, filtros: PagoFilters, formato: 'csv' | 'xlsx'): void {
    const filename = `pagos_${filtros.fecha_desde}_${filtros.fecha_hasta}.${formato}`;
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
    this.pagosService.listPagos(this.filtrosVigentes, page).subscribe({
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
