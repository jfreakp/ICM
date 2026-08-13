import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { Mock, vi } from 'vitest';
import { CambiarContrasenaComponent } from './cambiar-contrasena.component';
import { AuthService } from '../../core/auth.service';
import { User } from '../../core/models/user.model';

describe('CambiarContrasenaComponent', () => {
  let fixture: ComponentFixture<CambiarContrasenaComponent>;
  let authService: { changeOwnPassword: Mock };
  let router: { navigate: Mock };

  function fillForm(
    overrides: Partial<{ currentPassword: string; newPassword: string; confirmPassword: string }> = {}
  ): void {
    fixture.componentInstance.form.setValue({
      currentPassword: overrides.currentPassword ?? 'Temporal123!',
      newPassword: overrides.newPassword ?? 'Definitiva456!',
      confirmPassword: overrides.confirmPassword ?? 'Definitiva456!',
    });
  }

  beforeEach(async () => {
    authService = { changeOwnPassword: vi.fn() };
    router = { navigate: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [CambiarContrasenaComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CambiarContrasenaComponent);
    fixture.detectChanges();
  });

  it('disables submit when the form is invalid', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="guardar-cambiar-contrasena"]'
    );
    expect(button.disabled).toBe(true);
  });

  it('disables submit when the new password is shorter than 8 characters', () => {
    fillForm({ newPassword: 'short1', confirmPassword: 'short1' });
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="guardar-cambiar-contrasena"]'
    );
    expect(button.disabled).toBe(true);
  });

  it('shows a mismatch message when the new passwords do not match', () => {
    fillForm({ confirmPassword: 'Different1!' });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Las contraseñas no coinciden.');
  });

  it('calls changeOwnPassword and navigates to /home on success', () => {
    const updated: User = {
      id: 1,
      email: 'a@b.com',
      full_name: 'A',
      is_admin: false,
      must_change_password: false,
    };
    authService.changeOwnPassword.mockReturnValue(of(updated));

    fillForm();
    fixture.componentInstance.onSubmit();

    expect(authService.changeOwnPassword).toHaveBeenCalledWith('Temporal123!', 'Definitiva456!');
    expect(router.navigate).toHaveBeenCalledWith(['/home']);
  });

  describe('async error handling under zoneless change detection', () => {
    it('shows the wrong-current-password message on a 401 without navigating', async () => {
      const result$ = new Subject<User>();
      authService.changeOwnPassword.mockReturnValue(result$);

      fillForm();
      fixture.componentInstance.onSubmit();

      result$.error(new HttpErrorResponse({ status: 401 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Contraseña actual incorrecta.');
      expect(router.navigate).not.toHaveBeenCalled();
    });

    it('shows a generic error message on a non-401 failure', async () => {
      const result$ = new Subject<User>();
      authService.changeOwnPassword.mockReturnValue(result$);

      fillForm();
      fixture.componentInstance.onSubmit();

      result$.error(new HttpErrorResponse({ status: 500 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudo cambiar la contraseña. Intenta de nuevo.');
    });
  });
});
