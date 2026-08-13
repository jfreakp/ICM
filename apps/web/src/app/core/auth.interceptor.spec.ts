import { TestBed } from '@angular/core/testing';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { Mock, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpMock: HttpTestingController;
  let authService: { getToken: Mock; logout: Mock };
  let router: { navigate: Mock };

  beforeEach(() => {
    authService = { getToken: vi.fn(), logout: vi.fn() };
    router = { navigate: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService },
        { provide: Router, useValue: router },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('adds the Authorization header when a token is present', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.get('/api/whatever').subscribe();

    const req = httpMock.expectOne('/api/whatever');
    expect(req.request.headers.get('Authorization')).toBe('Bearer fake-token');
    req.flush({});
  });

  it('does not add the header when there is no token', () => {
    authService.getToken.mockReturnValue(null);

    http.get('/api/whatever').subscribe();

    const req = httpMock.expectOne('/api/whatever');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush({});
  });

  it('logs out and redirects to /login on a 401 response', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.get('/api/whatever').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/whatever');
    req.flush({ detail: 'No autenticado' }, { status: 401, statusText: 'Unauthorized' });

    expect(authService.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login']);
  });

  it('does not log out or redirect on a 401 from the login endpoint itself', () => {
    authService.getToken.mockReturnValue(null);

    http.post('/api/auth/login', { email: 'a@b.com', password: 'wrong' }).subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/login');
    req.flush({ detail: 'Credenciales inválidas' }, { status: 401, statusText: 'Unauthorized' });

    expect(authService.logout).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('logs out and redirects with reason=ip_blocked on a 403 ip_not_allowed response', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.get('/api/auth/me').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/me');
    req.flush(
      { detail: { code: 'ip_not_allowed', message: 'IP no autorizada' } },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(authService.logout).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reason: 'ip_blocked' } });
  });

  it('does not log out on a 403 that is not an IP block (e.g. admin_required)', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.get('/api/auth/users').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/users');
    req.flush(
      { detail: { code: 'admin_required', message: 'Requiere permisos de administrador' } },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(authService.logout).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('does not log out or redirect on a 401 from the logout endpoint itself', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.post('/api/auth/logout', {}).subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/logout');
    req.flush({ detail: 'No autenticado' }, { status: 401, statusText: 'Unauthorized' });

    expect(authService.logout).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('redirects to /cambiar-contrasena without logging out on a 403 password_change_required response', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.get('/api/reportes/impugnaciones/estados').subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/reportes/impugnaciones/estados');
    req.flush(
      { detail: { code: 'password_change_required', message: 'Debes cambiar tu contraseña' } },
      { status: 403, statusText: 'Forbidden' }
    );

    expect(authService.logout).not.toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalledWith(['/cambiar-contrasena']);
  });

  it('does not log out or redirect on a 401 from the change-own-password endpoint', () => {
    authService.getToken.mockReturnValue('fake-token');

    http.patch('/api/auth/me/password', { current_password: 'wrong', new_password: 'NewPass123!' }).subscribe({ error: () => {} });

    const req = httpMock.expectOne('/api/auth/me/password');
    req.flush({ detail: 'Contraseña actual incorrecta' }, { status: 401, statusText: 'Unauthorized' });

    expect(authService.logout).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });
});
