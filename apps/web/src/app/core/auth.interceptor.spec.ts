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
});
