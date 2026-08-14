import { Component, OnInit, inject } from '@angular/core';
import { AsyncPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';
import { AuditoriaService } from '../../core/auditoria.service';
import { AuditLogFilters, AuditLogItem, AuditLogListResponse } from '../../core/models/audit-log.model';

const LOAD_ERROR_MESSAGE = 'No se pudieron cargar los eventos de auditoría. Intenta de nuevo.';
const FORBIDDEN_MESSAGE = 'No tienes permisos para ver esta página.';

export const ACCIONES: { value: string; label: string }[] = [
  { value: 'auth.login_success', label: 'Inicio de sesión exitoso' },
  { value: 'auth.login_failed', label: 'Inicio de sesión fallido' },
  { value: 'auth.login_blocked_ip', label: 'Inicio de sesión bloqueado por IP' },
  { value: 'auth.logout', label: 'Cierre de sesión' },
  { value: 'reportes.impugnaciones.search', label: 'Búsqueda de impugnaciones' },
  { value: 'reportes.impugnaciones.export', label: 'Descarga de impugnaciones' },
  { value: 'reportes.infracciones.search', label: 'Búsqueda de infracciones' },
  { value: 'reportes.infracciones.export', label: 'Descarga de infracciones' },
  { value: 'reportes.juicios.search', label: 'Búsqueda de juicios' },
  { value: 'reportes.juicios.export', label: 'Descarga de juicios' },
  { value: 'usuarios.update_allowed_ip', label: 'Cambio de IP permitida' },
];

const EMPTY_FILTERS: AuditLogFilters = { desde: null, hasta: null, accion: null, usuarioEmail: null };

@Component({
  selector: 'app-auditoria',
  standalone: true,
  imports: [AsyncPipe, DatePipe, ReactiveFormsModule, AppShellComponent],
  templateUrl: './auditoria.component.html',
})
export class AuditoriaComponent implements OnInit {
  private readonly auditoriaService = inject(AuditoriaService);
  private readonly fb = inject(FormBuilder);

  readonly acciones = ACCIONES;

  readonly form = this.fb.nonNullable.group({
    desde: [''],
    hasta: [''],
    accion: [''],
    usuarioEmail: [''],
  });

  private readonly resultadoSubject = new BehaviorSubject<AuditLogListResponse | null>(null);
  readonly resultado$ = this.resultadoSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  readonly loading$ = this.loadingSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  private filtrosVigentes: AuditLogFilters = EMPTY_FILTERS;

  ngOnInit(): void {
    this.cargarPagina(1);
  }

  buscar(): void {
    const { desde, hasta, accion, usuarioEmail } = this.form.getRawValue();
    this.filtrosVigentes = {
      desde: desde || null,
      hasta: hasta || null,
      accion: accion || null,
      usuarioEmail: usuarioEmail || null,
    };
    this.cargarPagina(1);
  }

  cambiarPagina(page: number): void {
    this.cargarPagina(page);
  }

  accionLabel(action: string): string {
    return this.acciones.find((a) => a.value === action)?.label ?? action;
  }

  detalle(item: AuditLogItem): string {
    const d = item.details ?? {};
    switch (item.action) {
      case 'auth.login_blocked_ip':
        return `IP esperada: ${d['ip_esperada']}`;
      case 'reportes.impugnaciones.search': {
        const estadoTxt = d['estado'] ? `, estado=${d['estado']}` : '';
        return `Buscó impugnaciones ${d['fecha_desde']} a ${d['fecha_hasta']}${estadoTxt}, ${d['total']} resultados`;
      }
      case 'reportes.impugnaciones.export': {
        const estadoTxt = d['estado'] ? `, estado=${d['estado']}` : '';
        return `Descargó impugnaciones ${d['fecha_desde']} a ${d['fecha_hasta']}${estadoTxt} en ${String(d['formato']).toUpperCase()}, ${d['filas_exportadas']} filas`;
      }
      case 'usuarios.update_allowed_ip':
        return `Usuario #${d['usuario_objetivo_id']}: IP ${d['ip_anterior'] ?? 'sin anclar'} → ${d['ip_nueva'] ?? 'sin anclar'}`;
      default:
        return '—';
    }
  }

  private cargarPagina(page: number): void {
    this.loadingSubject.next(true);
    this.errorSubject.next(null);
    this.auditoriaService.listEventos(this.filtrosVigentes, page).subscribe({
      next: (resultado) => {
        this.resultadoSubject.next(resultado);
        this.loadingSubject.next(false);
      },
      error: (err) => {
        this.resultadoSubject.next(null);
        this.errorSubject.next(err?.status === 403 ? FORBIDDEN_MESSAGE : LOAD_ERROR_MESSAGE);
        this.loadingSubject.next(false);
      },
    });
  }
}
