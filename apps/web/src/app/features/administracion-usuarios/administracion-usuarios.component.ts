import { Component, OnInit, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AsyncPipe } from '@angular/common';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

@Component({
  selector: 'app-administracion-usuarios',
  standalone: true,
  imports: [AsyncPipe, AppShellComponent],
  templateUrl: './administracion-usuarios.component.html',
})
export class AdministracionUsuariosComponent implements OnInit {
  private readonly usersService = inject(UsersService);

  private readonly usuariosSubject = new BehaviorSubject<UserListItem[]>([]);
  readonly usuarios$ = this.usuariosSubject.asObservable();

  ngOnInit(): void {
    this.usersService.listUsers().subscribe((usuarios) => this.usuariosSubject.next(usuarios));
  }

  resetAllowedIp(usuario: UserListItem): void {
    this.usersService.updateAllowedIp(usuario.id, null).subscribe((updated) => {
      const usuarios = this.usuariosSubject.value.map((u) =>
        u.id === updated.id ? { ...u, allowed_ip: updated.allowed_ip } : u
      );
      this.usuariosSubject.next(usuarios);
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
