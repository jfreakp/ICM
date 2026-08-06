import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { Mock, vi } from 'vitest';
import { HomeComponent } from './home.component';
import { AuthService } from '../../core/auth.service';
import { User } from '../../core/models/user.model';

describe('HomeComponent', () => {
  let fixture: ComponentFixture<HomeComponent>;
  let authService: { logout: Mock; loadCurrentUser: Mock; currentUser$: BehaviorSubject<User | null> };
  let router: { navigate: Mock };
  let currentUser$: BehaviorSubject<User | null>;

  beforeEach(async () => {
    currentUser$ = new BehaviorSubject<User | null>({ id: 1, email: 'a@b.com', full_name: 'Ana Pérez' });
    authService = { logout: vi.fn(), loadCurrentUser: vi.fn(), currentUser$ };
    authService.loadCurrentUser.mockReturnValue(of(null));
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [HomeComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(HomeComponent);
    fixture.detectChanges();
  });

  it('displays the current user full name', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Pérez');
  });

  it('logs out and navigates to /login when the button is clicked', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="logout-btn"]');
    button.click();

    expect(authService.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });
});
