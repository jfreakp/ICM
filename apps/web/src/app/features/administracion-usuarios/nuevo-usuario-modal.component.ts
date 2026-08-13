import { Component, EventEmitter, Output, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject } from 'rxjs';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

const DUPLICATE_EMAIL_MESSAGE = 'Ya existe un usuario con ese email.';
const GENERIC_ERROR_MESSAGE = 'No se pudo crear el usuario. Intenta de nuevo.';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return password && confirmPassword && password !== confirmPassword ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-nuevo-usuario-modal',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './nuevo-usuario-modal.component.html',
})
export class NuevoUsuarioModalComponent {
  private readonly usersService = inject(UsersService);
  private readonly fb = inject(FormBuilder);

  @Output() readonly creado = new EventEmitter<UserListItem>();
  @Output() readonly cancelado = new EventEmitter<void>();

  readonly form = this.fb.nonNullable.group(
    {
      email: ['', [Validators.required, Validators.email]],
      fullName: ['', Validators.required],
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
      confirmPassword: ['', Validators.required],
      isAdmin: [false],
    },
    { validators: passwordsMatch }
  );

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  get passwordMismatch(): boolean {
    return this.form.hasError('passwordMismatch') && !!this.form.get('confirmPassword')?.value;
  }

  guardar(): void {
    if (this.form.invalid) {
      return;
    }
    const { email, fullName, password, isAdmin } = this.form.getRawValue();
    this.errorSubject.next(null);
    this.usersService.createUser({ email, full_name: fullName, password, is_admin: isAdmin }).subscribe({
      next: (usuario) => this.creado.emit(usuario),
      error: (err: HttpErrorResponse) => {
        this.errorSubject.next(err.status === 409 ? DUPLICATE_EMAIL_MESSAGE : GENERIC_ERROR_MESSAGE);
      },
    });
  }

  cancelar(): void {
    this.cancelado.emit();
  }
}
