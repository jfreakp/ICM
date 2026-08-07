import { Component, inject, OnInit } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AuthService } from '../../core/auth.service';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [AsyncPipe, AppShellComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent implements OnInit {
  private readonly authService = inject(AuthService);

  readonly currentUser$ = this.authService.currentUser$;

  readonly kpis = [
    { label: 'Total Multas Registradas', value: '12,450', trend: '+5%', icon: 'receipt_long' },
    { label: 'Recaudación del Mes', value: '$45.2K', trend: '+12%', icon: 'payments' },
    { label: 'Multas Pendientes', value: '3,120', trend: '+2%', icon: 'warning' },
    { label: 'Usuarios Activos', value: '85', trend: 'hoy', icon: 'group' },
  ];

  readonly actividadReciente = [
    { ciudadano: 'Juan Pérez Morales', fecha: '12 Oct 2023', monto: '$120.00', estado: 'Pagado' },
    { ciudadano: 'María Elena Castro', fecha: '11 Oct 2023', monto: '$45.50', estado: 'Pendiente' },
    { ciudadano: 'Carlos Rojas', fecha: '11 Oct 2023', monto: '$250.00', estado: 'Pendiente' },
    { ciudadano: 'Ana Silva', fecha: '10 Oct 2023', monto: '$85.00', estado: 'Pagado' },
    { ciudadano: 'Roberto Núñez', fecha: '09 Oct 2023', monto: '$300.00', estado: 'Pendiente' },
  ];

  ngOnInit(): void {
    this.authService.loadCurrentUser().subscribe();
  }
}
