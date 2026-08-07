import { Component } from '@angular/core';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';

@Component({
  selector: 'app-administracion-usuarios',
  standalone: true,
  imports: [AppShellComponent],
  templateUrl: './administracion-usuarios.component.html',
})
export class AdministracionUsuariosComponent {
  readonly usuarios = [
    { nombre: 'Ana Silva Pérez', email: 'ana.silva@icmloja.gob.ec', rol: 'Admin', estado: 'Activo' },
    { nombre: 'Carlos Mendoza', email: 'c.mendoza@icmloja.gob.ec', rol: 'Employee', estado: 'Activo' },
    { nombre: 'Lucía Torres', email: 'ltorres@icmloja.gob.ec', rol: 'Employee', estado: 'Inactivo' },
    { nombre: 'Javier Ruíz', email: 'jruiz@icmloja.gob.ec', rol: 'Employee', estado: 'Activo' },
  ];

  estadoBadgeClass(estado: string): string {
    return estado === 'Activo'
      ? 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#e6f4ea] text-[#137333] border border-[#ceead6]'
      : 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#fce8e6] text-[#c5221f] border border-[#fad2cf]';
  }
}
