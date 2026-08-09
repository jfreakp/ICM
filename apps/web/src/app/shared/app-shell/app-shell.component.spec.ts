import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { vi } from 'vitest';
import { AppShellComponent, AppShellRoute } from './app-shell.component';
import { AuthService } from '../../core/auth.service';
import { User } from '../../core/models/user.model';

const ADMIN_USER: User = { id: 1, email: 'admin@icmloja.gob.ec', full_name: 'Admin User', is_admin: true };
const NON_ADMIN_USER: User = { id: 2, email: 'user@icmloja.gob.ec', full_name: 'Regular User', is_admin: false };

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let authService: {
    logout: ReturnType<typeof vi.fn>;
    loadCurrentUser: ReturnType<typeof vi.fn>;
    currentUser$: Observable<User | null>;
  };
  let router: Router;

  function createComponent(activeRoute: AppShellRoute = 'dashboard'): void {
    fixture = TestBed.createComponent(AppShellComponent);
    fixture.componentInstance.activeRoute = activeRoute;
    fixture.detectChanges();
  }

  beforeEach(async () => {
    authService = {
      logout: vi.fn(),
      loadCurrentUser: vi.fn().mockReturnValue(of(null)),
      currentUser$: of(ADMIN_USER),
    };

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    createComponent();
  });

  it('highlights the Dashboard link when activeRoute is dashboard', () => {
    const dashboardLink: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href="/home"]');
    expect(dashboardLink.classList.contains('text-secondary-fixed-dim')).toBe(true);
  });

  it('logs out and navigates to /login when the logout link is clicked', () => {
    const button: HTMLElement = fixture.nativeElement.querySelector('[data-testid="logout-btn"]');
    button.click();

    expect(authService.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('validates the session on init by calling loadCurrentUser', () => {
    expect(authService.loadCurrentUser).toHaveBeenCalled();
  });

  it('shows the Administración de Usuarios link when the current user is an admin', () => {
    authService.currentUser$ = of(ADMIN_USER);
    createComponent();

    const usuariosLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[href="/usuarios"]');
    expect(usuariosLink).not.toBeNull();
  });

  it('hides the Administración de Usuarios link when the current user is not an admin', () => {
    authService.currentUser$ = of(NON_ADMIN_USER);
    createComponent();

    const usuariosLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector('a[href="/usuarios"]');
    expect(usuariosLink).toBeNull();
  });

  describe('submenu de Reportes', () => {
    it('collapses the Reportes submenu by default when activeRoute is dashboard', () => {
      const impugnacionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/impugnaciones"]'
      );
      expect(impugnacionesLink).toBeNull();
    });

    it('expands the Reportes submenu when the toggle is clicked', () => {
      const toggle: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="reportes-toggle"]');
      toggle.click();
      fixture.detectChanges();

      const impugnacionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/impugnaciones"]'
      );
      expect(impugnacionesLink).not.toBeNull();
    });

    it('auto-expands and highlights Impugnaciones when activeRoute is impugnaciones', () => {
      createComponent('impugnaciones');

      const impugnacionesLink: HTMLAnchorElement | null = fixture.nativeElement.querySelector(
        'a[href="/reportes/impugnaciones"]'
      );
      expect(impugnacionesLink).not.toBeNull();
      expect(impugnacionesLink!.classList.contains('text-secondary-fixed-dim')).toBe(true);
    });
  });
});
