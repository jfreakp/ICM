import { Component, inject, Input } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';

export type AppShellRoute = 'dashboard' | 'reportes' | 'usuarios';

const ACTIVE_LINK_CLASS =
  'flex items-center gap-sm px-md py-sm text-secondary-fixed-dim border-l-4 border-secondary-fixed font-bold transition-colors duration-200';
const INACTIVE_LINK_CLASS =
  'flex items-center gap-sm px-md py-sm text-on-primary/70 hover:text-on-primary hover:bg-primary-container transition-colors duration-200';

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './app-shell.component.html',
})
export class AppShellComponent {
  @Input({ required: true }) activeRoute!: AppShellRoute;

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  navLinkClass(route: AppShellRoute): string {
    return route === this.activeRoute ? ACTIVE_LINK_CLASS : INACTIVE_LINK_CLASS;
  }

  onLogout(): void {
    this.authService.logout();
    this.router.navigate(['/login']);
  }
}
