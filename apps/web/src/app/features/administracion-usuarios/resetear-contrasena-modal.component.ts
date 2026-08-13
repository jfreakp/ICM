import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';
import { UsersService } from '../../core/users.service';
import { UserListItem } from '../../core/models/user-list-item.model';

const GENERIC_ERROR_MESSAGE = 'No se pudo resetear la contraseña. Intenta de nuevo.';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('password')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return password && confirmPassword && password !== confirmPassword ? { passwordMismatch: true } : null;
}

@Component({
  selector: 'app-resetear-contrasena-modal',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './resetear-contrasena-modal.component.html',
})
export class ResetearContrasenaModalComponent {
  private readonly usersService = inject(UsersService);
  private readonly fb = inject(FormBuilder);

  @Input({ required: true }) usuario!: UserListItem;
  @Output() readonly reseteado = new EventEmitter<void>();
  @Output() readonly cancelado = new EventEmitter<void>();

  readonly form = this.fb.nonNullable.group(
    {
      password: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
      confirmPassword: ['', Validators.required],
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
    const { password } = this.form.getRawValue();
    this.errorSubject.next(null);
    this.usersService.resetPassword(this.usuario.id, password).subscribe({
      next: () => this.reseteado.emit(),
      error: () => this.errorSubject.next(GENERIC_ERROR_MESSAGE),
    });
  }

  cancelar(): void {
    this.cancelado.emit();
  }
}
