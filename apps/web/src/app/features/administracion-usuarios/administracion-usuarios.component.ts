import { Component, OnInit, inject } from '@angular/core';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

@Component({
  selector: 'app-administracion-usuarios',
  standalone: true,
  imports: [AppShellComponent],
  templateUrl: './administracion-usuarios.component.html',
})
export class AdministracionUsuariosComponent implements OnInit {
  private readonly usersService = inject(UsersService);

  usuarios: UserListItem[] = [];

  ngOnInit(): void {
    this.usersService.listUsers().subscribe((usuarios) => (this.usuarios = usuarios));
  }

  resetAllowedIp(usuario: UserListItem): void {
    this.usersService.updateAllowedIp(usuario.id, null).subscribe((updated) => {
      usuario.allowed_ip = updated.allowed_ip;
    });
  }

  rolLabel(usuario: UserListItem): string {
    return usuario.is_admin ? 'Admin' : 'Employee';
  }

  estadoLabel(usuario: UserListItem): string {
    return usuario.is_active ? 'Activo' : 'Inactivo';
  }

  estadoBadgeClass(usuario: UserListItem): string {
    return usuario.is_active
      ? 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#e6f4ea] text-[#137333] border border-[#ceead6]'
      : 'inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-[#fce8e6] text-[#c5221f] border border-[#fad2cf]';
  }
}
