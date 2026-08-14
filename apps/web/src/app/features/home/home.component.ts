import { Component, inject, OnInit } from '@angular/core';
import { AsyncPipe, DecimalPipe } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { DashboardService } from '../../core/dashboard.service';
import { ResumenTablaItem } from '../../core/models/dashboard-resumen.model';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';

const LOAD_ERROR_MESSAGE = 'No se pudo cargar el resumen. Intenta de nuevo.';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AsyncPipe, DecimalPipe, AppShellComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly dashboardService = inject(DashboardService);

  readonly currentUser$ = this.authService.currentUser$;

  private readonly resumenSubject = new BehaviorSubject<ResumenTablaItem[]>([]);
  readonly resumen$ = this.resumenSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  readonly actividadReciente = [
    { ciudadano: 'Juan Pérez Morales', fecha: '12 Oct 2023', monto: '$120.00', estado: 'Pagado' },
    { ciudadano: 'María Elena Castro', fecha: '11 Oct 2023', monto: '$45.50', estado: 'Pendiente' },
    { ciudadano: 'Carlos Rojas', fecha: '11 Oct 2023', monto: '$250.00', estado: 'Pendiente' },
    { ciudadano: 'Ana Silva', fecha: '10 Oct 2023', monto: '$85.00', estado: 'Pagado' },
    { ciudadano: 'Roberto Núñez', fecha: '09 Oct 2023', monto: '$300.00', estado: 'Pendiente' },
  ];

  ngOnInit(): void {
    this.authService.loadCurrentUser().subscribe();
    this.dashboardService.getResumen().subscribe({
      next: (resumen) => this.resumenSubject.next(resumen.tablas),
      error: () => this.errorSubject.next(LOAD_ERROR_MESSAGE),
    });
  }
}
