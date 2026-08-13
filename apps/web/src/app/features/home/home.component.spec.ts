import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { HomeComponent } from './home.component';
import { AuthService } from '../../core/auth.service';
import { User } from '../../core/models/user.model';

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;

  beforeEach(async () => {
    const authService = {
      loadCurrentUser: vi.fn().mockReturnValue(of(null)),
      currentUser$: of<User | null>({ id: 1, email: 'a@b.com', full_name: 'Ana Pérez', is_admin: false, must_change_password: false }),
    };

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: authService }],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });

  it('displays the current user full name', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Pérez');
  });

  it('displays KPI cards with placeholder metrics', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Total Multas Registradas');
    expect(text).toContain('12,450');
  });

  it('displays the recent activity table', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Actividad Reciente');
    expect(text).toContain('Juan Pérez Morales');
  });
});
