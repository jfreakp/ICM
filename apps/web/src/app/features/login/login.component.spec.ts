import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { Mock, vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth.service';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let component: LoginComponent;
  let authService: { login: Mock };
  let router: { navigate: Mock };

  beforeEach(async () => {
    authService = { login: vi.fn() };
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [LoginComponent, ReactiveFormsModule],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LoginComponent);
    component = fixture.componentInstance;
  });

  it('navigates to /home on successful login', () => {
    authService.login.mockReturnValue(of({ id: 1, email: 'a@b.com', full_name: 'A' }));
    component.form.setValue({ email: 'a@b.com', password: 'secret' });

    component.onSubmit();

    expect(authService.login).toHaveBeenCalledWith('a@b.com', 'secret');
    expect(router.navigate).toHaveBeenCalledWith(['/home']);
  });

  it('shows an error message on failed login', () => {
    authService.login.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 401, error: { detail: 'Credenciales inválidas' } }))
    );
    component.form.setValue({ email: 'a@b.com', password: 'wrong' });

    component.onSubmit();

    expect(component.errorMessage).toBe('Credenciales inválidas');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not call login when the form is invalid', () => {
    component.form.setValue({ email: '', password: '' });

    component.onSubmit();

    expect(authService.login).not.toHaveBeenCalled();
  });
});
