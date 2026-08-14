import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { HomeComponent } from './home.component';
import { AuthService } from '../../core/auth.service';
import { DashboardService } from '../../core/dashboard.service';
import { User } from '../../core/models/user.model';
import { DashboardResumenResponse } from '../../core/models/dashboard-resumen.model';

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;

  const resumen: DashboardResumenResponse = {
    tablas: [
      { tabla: 'crv', etiqueta: 'CRV', total: 16 },
      { tabla: 'impugnaciones', etiqueta: 'Impugnaciones', total: 99788 },
    ],
  };

  beforeEach(async () => {
    const authService = {
      loadCurrentUser: vi.fn().mockReturnValue(of(null)),
      currentUser$: of<User | null>({ id: 1, email: 'a@b.com', full_name: 'Ana Pérez', is_admin: false, must_change_password: false }),
    };
    const dashboardService = {
      getResumen: vi.fn().mockReturnValue(of(resumen)),
    };

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
        { provide: DashboardService, useValue: dashboardService },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });

  it('displays the current user full name', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Pérez');
  });

  it('displays real table totals from the dashboard summary', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('CRV');
    expect(text).toContain('16');
    expect(text).toContain('Impugnaciones');
    expect(text).toContain('99,788');
  });

  it('displays the recent activity table', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Actividad Reciente');
    expect(text).toContain('Juan Pérez Morales');
  });
});
