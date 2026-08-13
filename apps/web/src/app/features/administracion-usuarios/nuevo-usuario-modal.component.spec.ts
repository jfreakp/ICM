import { ComponentFixture, TestBed } from '@angular/core/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, Subject } from 'rxjs';
import { vi } from 'vitest';
import { NuevoUsuarioModalComponent } from './nuevo-usuario-modal.component';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

describe('NuevoUsuarioModalComponent', () => {
  let fixture: ComponentFixture<NuevoUsuarioModalComponent>;
  let usersService: { createUser: ReturnType<typeof vi.fn> };

  function fillForm(overrides: Partial<{ email: string; fullName: string; password: string; confirmPassword: string; isAdmin: boolean }> = {}): void {
    fixture.componentInstance.form.setValue({
      email: overrides.email ?? 'nuevo@example.com',
      fullName: overrides.fullName ?? 'Nuevo Usuario',
      password: overrides.password ?? 'Sup3rSecret!',
      confirmPassword: overrides.confirmPassword ?? 'Sup3rSecret!',
      isAdmin: overrides.isAdmin ?? false,
    });
  }

  beforeEach(async () => {
    usersService = { createUser: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [NuevoUsuarioModalComponent],
      providers: [{ provide: UsersService, useValue: usersService }],
    }).compileComponents();

    fixture = TestBed.createComponent(NuevoUsuarioModalComponent);
    fixture.detectChanges();
  });

  it('disables submit when the form is invalid', () => {
    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="guardar-nuevo-usuario"]');
    expect(button.disabled).toBe(true);
  });

  it('disables submit when the email is invalid', () => {
    fillForm({ email: 'not-an-email' });
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="guardar-nuevo-usuario"]');
    expect(button.disabled).toBe(true);
  });

  it('disables submit when the password is shorter than 8 characters', () => {
    fillForm({ password: 'short1', confirmPassword: 'short1' });
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="guardar-nuevo-usuario"]');
    expect(button.disabled).toBe(true);
  });

  it('shows a mismatch message when the passwords do not match', () => {
    fillForm({ confirmPassword: 'Different1!' });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('Las contraseñas no coinciden.');
  });

  it('calls createUser with the mapped payload and emits creado on success', () => {
    const creado = vi.fn();
    fixture.componentInstance.creado.subscribe(creado);
    const created: UserListItem = { id: 5, email: 'nuevo@example.com', full_name: 'Nuevo Usuario', is_admin: false, is_active: true, allowed_ip: null };
    usersService.createUser.mockReturnValue(of(created));

    fillForm();
    fixture.componentInstance.guardar();

    expect(usersService.createUser).toHaveBeenCalledWith({
      email: 'nuevo@example.com',
      full_name: 'Nuevo Usuario',
      password: 'Sup3rSecret!',
      is_admin: false,
    });
    expect(creado).toHaveBeenCalledWith(created);
  });

  it('emits cancelado when cancel is clicked', () => {
    const cancelado = vi.fn();
    fixture.componentInstance.cancelado.subscribe(cancelado);

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('[data-testid="cancelar-nuevo-usuario"]');
    button.click();

    expect(cancelado).toHaveBeenCalled();
  });

  describe('async error handling under zoneless change detection', () => {
    it('shows the duplicate-email message on a 409 without closing the modal', async () => {
      const result$ = new Subject<UserListItem>();
      usersService.createUser.mockReturnValue(result$);
      const creado = vi.fn();
      fixture.componentInstance.creado.subscribe(creado);

      fillForm();
      fixture.componentInstance.guardar();

      result$.error(new HttpErrorResponse({ status: 409 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('Ya existe un usuario con ese email.');
      expect(creado).not.toHaveBeenCalled();
    });

    it('shows a generic error message on a non-409 failure', async () => {
      const result$ = new Subject<UserListItem>();
      usersService.createUser.mockReturnValue(result$);

      fillForm();
      fixture.componentInstance.guardar();

      result$.error(new HttpErrorResponse({ status: 500 }));
      await fixture.whenStable();

      const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
      expect(text).toContain('No se pudo crear el usuario. Intenta de nuevo.');
    });
  });
});
