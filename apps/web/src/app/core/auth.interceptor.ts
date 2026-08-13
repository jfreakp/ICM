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

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);
  const token = authService.getToken();

  const authReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      const isLoginRequest = req.url.includes('/auth/login');
      const isLogoutRequest = req.url.includes('/auth/logout');
      if (!isLoginRequest && !isLogoutRequest && error.status === 401) {
        authService.logout();
        router.navigate(['/login']);
      } else if (!isLoginRequest && !isLogoutRequest && isIpBlocked(error)) {
        authService.logout();
        router.navigate(['/login'], { queryParams: { reason: 'ip_blocked' } });
      }
      return throwError(() => error);
    })
  );
};
