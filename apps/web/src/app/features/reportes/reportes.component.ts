import { Component } from '@angular/core';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';

@Component({
  selector: 'app-reportes',
  standalone: true,
  imports: [AppShellComponent],
  templateUrl: './reportes.component.html',
})
export class ReportesComponent {
  readonly multas = [
    { id: '#MLT-2023-0891', ciudadano: 'Juan Pérez Gómez', fecha: '12 Oct 2023', valor: '$120.00', estado: 'Pendiente' },
    { id: '#MLT-2023-0890', ciudadano: 'María López Ruiz', fecha: '10 Oct 2023', valor: '$45.50', estado: 'Pagado' },
    { id: '#MLT-2023-0889', ciudadano: 'Carlos Mendoza V.', fecha: '08 Oct 2023', valor: '$250.00', estado: 'Anulado' },
    { id: '#MLT-2023-0888', ciudadano: 'Ana Torres Silva', fecha: '05 Oct 2023', valor: '$60.00', estado: 'Pagado' },
    { id: '#MLT-2023-0887', ciudadano: 'Luis Castro D.', fecha: '01 Oct 2023', valor: '$180.00', estado: 'Pendiente' },
  ];

  estadoBadgeClass(estado: string): string {
    switch (estado) {
      case 'Pagado':
        return 'inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold bg-surface-container-high text-primary';
      case 'Anulado':
        return 'inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold bg-error-container text-on-error-container';
      default:
        return 'inline-flex items-center px-2 py-1 rounded-full text-[11px] font-semibold bg-tertiary-fixed text-tertiary';
    }
  }
}
