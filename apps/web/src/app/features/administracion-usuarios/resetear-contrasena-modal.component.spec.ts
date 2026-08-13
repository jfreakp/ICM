import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { ResetearContrasenaModalComponent } from './resetear-contrasena-modal.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

describe('ResetearContrasenaModalComponent', () => {
  let fixture: ComponentFixture<ResetearContrasenaModalComponent>;
  let usersService: { resetPassword: ReturnType<typeof vi.fn> };

  const usuario: UserListItem = {
    id: 7,
    email: 'ana@example.com',
    full_name: 'Ana Silva',
    is_admin: false,
    is_active: true,
    allowed_ip: null,
  };

  function fillForm(overrides: Partial<{ password: string; confirmPassword: string }> = {}): void {
    fixture.componentInstance.form.setValue({
      password: overrides.password ?? 'NuevaClave123!',
      confirmPassword: overrides.confirmPassword ?? 'NuevaClave123!',
    });
  }

  beforeEach(async () => {
    usersService = { resetPassword: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [ResetearContrasenaModalComponent],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ResetearContrasenaModalComponent);
    fixture.componentInstance.usuario = usuario;
    fixture.detectChanges();
  });

  it('shows the target user\'s name in the title', () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Ana Silva');
  });

  it('disables submit when the form is invalid', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="guardar-resetear-clave"]');
    expect(button.disabled).toBe(true);
  });

  it('shows a mismatch message when the passwords do not match', () => {
    fillForm({ confirmPassword: 'Different1!' });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Las contraseñas no coinciden.');
  });

  it('calls resetPassword with the target user id and new password, and emits reseteado on success', () => {
    const reseteado = vi.fn();
    fixture.componentInstance.reseteado.subscribe(reseteado);
    usersService.resetPassword.mockReturnValue(of(usuario));

    fillForm();
    fixture.componentInstance.guardar();

    expect(usersService.resetPassword).toHaveBeenCalledWith(7, 'NuevaClave123!');
    expect(reseteado).toHaveBeenCalled();
  });

  it('emits cancelado when cancel is clicked', () => {
    const cancelado = vi.fn();
    fixture.componentInstance.cancelado.subscribe(cancelado);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="cancelar-resetear-clave"]');
    button.click();

    expect(cancelado).toHaveBeenCalled();
  });

  describe('async error handling under zoneless change detection', () => {
    it('shows a generic error message on failure without closing the modal', async () => {
      const result$ = new Subject<UserListItem>();
      usersService.resetPassword.mockReturnValue(result$);
      const reseteado = vi.fn();
      fixture.componentInstance.reseteado.subscribe(reseteado);

      fillForm();
      fixture.componentInstance.guardar();

      result$.error(new HttpErrorResponse({ status: 500 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudo resetear la contraseña. Intenta de nuevo.');
      expect(reseteado).not.toHaveBeenCalled();
    });
  });
});
