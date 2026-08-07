import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/auth.service';

interface StructuredErrorDetail {
  code?: string;
  message?: string;
}

const IP_BLOCKED_MESSAGE = 'Tu usuario está vinculado a otro equipo. Contacta al administrador.';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
})
export class LoginComponent implements OnInit {
  private readonly fb = inject(FormBuilder);
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  errorMessage: string | null = null;

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('reason') === 'ip_blocked') {
      this.errorMessage = IP_BLOCKED_MESSAGE;
    }
  }

  onSubmit(): void {
    this.errorMessage = null;
    if (this.form.invalid) {
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.authService.login(email, password).subscribe({
      next: () => this.router.navigate(['/home']),
      error: (err: HttpErrorResponse) => {
        const detail = err.error?.detail as string | StructuredErrorDetail | undefined;
        if (err.status === 403 && typeof detail === 'object' && detail?.code === 'ip_not_allowed') {
          this.errorMessage = IP_BLOCKED_MESSAGE;
        } else if (typeof detail === 'string') {
          this.errorMessage = detail;
        } else {
          this.errorMessage = 'Error al iniciar sesión';
        }
      },
    });
  }
}
