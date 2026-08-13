import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

interface StructuredErrorDetail {
  code?: string;
  message?: string;
}

function isIpBlocked(error: HttpErrorResponse): boolean {
  const detail = error.error?.detail as StructuredErrorDetail | undefined;
  return error.status === 403 && detail?.code === 'ip_not_allowed';
}

function isPasswordChangeRequired(error: HttpErrorResponse): boolean {
  const detail = error.error?.detail as StructuredErrorDetail | undefined;
  return error.status === 403 && detail?.code === 'password_change_required';
}

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();

  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      const isLoginRequest = req.url.includes('/auth/login');
      const isLogoutRequest = req.url.includes('/auth/logout');
      const isChangeOwnPasswordRequest = req.url.includes('/auth/me/password');
      if (!isLoginRequest && !isLogoutRequest && !isChangeOwnPasswordRequest && error.status === 401) {
        authService.logout();
        router.navigate(['/login']);
      } else if (!isLoginRequest && !isLogoutRequest && isIpBlocked(error)) {
        authService.logout();
        router.navigate(['/login'], { queryParams: { reason: 'ip_blocked' } });
      } else if (!isLoginRequest && !isLogoutRequest && isPasswordChangeRequired(error)) {
        router.navigate(['/cambiar-contrasena']);
      }
      return throwError(() => error);
    })
  );
};
