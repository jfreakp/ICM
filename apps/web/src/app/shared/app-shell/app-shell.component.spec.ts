import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { AppShellComponent } from './app-shell.component';
import { AuthService } from '../../core/auth.service';

describe('AppShellComponent', () => {
  let fixture: ComponentFixture<AppShellComponent>;
  let authService: { logout: ReturnType<typeof vi.fn>; loadCurrentUser: ReturnType<typeof vi.fn> };
  let router: Router;

  beforeEach(async () => {
    authService = { logout: vi.fn(), loadCurrentUser: vi.fn().mockReturnValue(of(null)) };

    await TestBed.configureTestingModule({
      imports: [AppShellComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(AppShellComponent);
    fixture.componentInstance.activeRoute = 'dashboard';
    fixture.detectChanges();
  });

  it('highlights the Dashboard link when activeRoute is dashboard', () => {
    const dashboardLink: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href="/home"]');
    expect(dashboardLink.classList.contains('text-secondary-fixed-dim')).toBe(true);
  });

  it('does not highlight Reportes when activeRoute is dashboard', () => {
    const reportesLink: HTMLAnchorElement = fixture.nativeElement.querySelector('a[href="/reportes"]');
    expect(reportesLink.classList.contains('text-secondary-fixed-dim')).toBe(false);
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
});
