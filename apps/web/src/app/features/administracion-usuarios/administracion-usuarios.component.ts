import { Component, OnInit, inject } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AsyncPipe } from '@angular/common';
import { AppShellComponent } from '../../shared/app-shell/app-shell.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';
import { NuevoUsuarioModalComponent } from './nuevo-usuario-modal.component';
import { ResetearContrasenaModalComponent } from './resetear-contrasena-modal.component';

@Component({
  selector: 'app-administracion-usuarios',
  standalone: true,
  imports: [AsyncPipe, AppShellComponent, NuevoUsuarioModalComponent, ResetearContrasenaModalComponent],
  templateUrl: './administracion-usuarios.component.html',
})
export class AdministracionUsuariosComponent implements OnInit {
  private readonly usersService = inject(UsersService);

  private readonly usuariosSubject = new BehaviorSubject<UserListItem[]>([]);
  readonly usuarios$ = this.usuariosSubject.asObservable();

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  mostrarModalNuevoUsuario = false;
  usuarioParaResetearClave: UserListItem | null = null;

  ngOnInit(): void {
    this.cargarUsuarios();
  }

  private cargarUsuarios(): void {
    this.usersService.listUsers().subscribe({
      next: (usuarios) => this.usuariosSubject.next(usuarios),
      error: () => this.errorSubject.next('No tienes permisos para ver esta página.'),
    });
  }

  resetAllowedIp(usuario: UserListItem): void {
    this.usersService.updateAllowedIp(usuario.id, null).subscribe({
      next: (updated) => {
        const usuarios = this.usuariosSubject.value.map((u) =>
          u.id === updated.id ? { ...u, allowed_ip: updated.allowed_ip } : u
        );
        this.usuariosSubject.next(usuarios);
      },
      error: () => this.errorSubject.next('No se pudo actualizar la IP. Intenta de nuevo.'),
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

  abrirModalNuevoUsuario(): void {
    this.mostrarModalNuevoUsuario = true;
  }

  cerrarModalNuevoUsuario(): void {
    this.mostrarModalNuevoUsuario = false;
  }

  onUsuarioCreado(): void {
    this.mostrarModalNuevoUsuario = false;
    this.cargarUsuarios();
  }

  abrirModalResetearClave(usuario: UserListItem): void {
    this.usuarioParaResetearClave = usuario;
  }

  cerrarModalResetearClave(): void {
    this.usuarioParaResetearClave = null;
  }

  onClaveReseteada(): void {
    this.usuarioParaResetearClave = null;
  }
}
