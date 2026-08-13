import { Component, inject } from '@angular/core';
import { AsyncPipe } from '@angular/common';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../core/auth.service';

const WRONG_CURRENT_PASSWORD_MESSAGE = 'Contraseña actual incorrecta.';
const GENERIC_ERROR_MESSAGE = 'No se pudo cambiar la contraseña. Intenta de nuevo.';

function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const newPassword = group.get('newPassword')?.value;
  const confirmPassword = group.get('confirmPassword')?.value;
  return newPassword && confirmPassword && newPassword !== confirmPassword
    ? { passwordMismatch: true }
    : null;
}

@Component({
  selector: 'app-cambiar-contrasena',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './cambiar-contrasena.component.html',
})
export class CambiarContrasenaComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  readonly form = this.fb.nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8), Validators.maxLength(72)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch }
  );

  private readonly errorSubject = new BehaviorSubject<string | null>(null);
  readonly error$ = this.errorSubject.asObservable();

  get passwordMismatch(): boolean {
    return this.form.hasError('passwordMismatch') && !!this.form.get('confirmPassword')?.value;
  }

  onSubmit(): void {
    if (this.form.invalid) {
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.errorSubject.next(null);
    this.authService.changeOwnPassword(currentPassword, newPassword).subscribe({
      next: () => this.router.navigate(['/home']),
      error: (err: HttpErrorResponse) => {
        this.errorSubject.next(err.status === 401 ? WRONG_CURRENT_PASSWORD_MESSAGE : GENERIC_ERROR_MESSAGE);
      },
    });
  }
}
