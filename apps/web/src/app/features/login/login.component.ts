import { Component, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AsyncPipe } from '@angular/common';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from '../../core/auth.service';

interface StructuredErrorDetail {
  code?: string;
  message?: string;
}

const IP_BLOCKED_MESSAGE = 'Tu usuario está vinculado a otro equipo. Contacta al administrador.';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule, AsyncPipe],
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

  private readonly errorMessageSubject = new BehaviorSubject<string | null>(null);
  readonly errorMessage$ = this.errorMessageSubject.asObservable();

  ngOnInit(): void {
    if (this.route.snapshot.queryParamMap.get('reason') === 'ip_blocked') {
      this.errorMessageSubject.next(IP_BLOCKED_MESSAGE);
    }
  }

  onSubmit(): void {
    this.errorMessageSubject.next(null);
    if (this.form.invalid) {
      return;
    }
    const { email, password } = this.form.getRawValue();
    this.authService.login(email, password).subscribe({
      next: (user) => this.router.navigate([user.must_change_password ? '/cambiar-contrasena' : '/home']),
      error: (err: HttpErrorResponse) => {
        const detail = err.error?.detail as string | StructuredErrorDetail | undefined;
        if (err.status === 403 && typeof detail === 'object' && detail?.code === 'ip_not_allowed') {
          this.errorMessageSubject.next(IP_BLOCKED_MESSAGE);
        } else if (typeof detail === 'string') {
          this.errorMessageSubject.next(detail);
        } else {
          this.errorMessageSubject.next('Error al iniciar sesión');
        }
      },
    });
  }
}
