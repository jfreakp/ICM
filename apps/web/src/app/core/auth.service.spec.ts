import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { AuthService } from './auth.service';
import { User } from './models/user.model';
import { environment } from '../../environments/environment';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [AuthService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  it('stores the token and emits the user on successful login', () => {
    let emittedUser: User | null = null;
    service.currentUser$.subscribe((user) => {
      emittedUser = user;
    });

    service.login('user@example.com', 'secret').subscribe();

    const loginReq = httpMock.expectOne(`${environment.apiUrl}/auth/login`);
    expect(loginReq.request.method).toBe('POST');
    loginReq.flush({ access_token: 'fake-token', token_type: 'bearer' });

    const meReq = httpMock.expectOne(`${environment.apiUrl}/auth/me`);
    meReq.flush({ id: 1, email: 'user@example.com', full_name: 'Test User' });

    expect(emittedUser).not.toBeNull();
    expect((emittedUser as User | null)?.email).toBe('user@example.com');
    expect(localStorage.getItem('access_token')).toBe('fake-token');
  });

  it('clears the token and emits null on logout', () => {
    localStorage.setItem('access_token', 'fake-token');
    service.logout();
    expect(localStorage.getItem('access_token')).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('isAuthenticated reflects presence of a stored token', () => {
    expect(service.isAuthenticated()).toBe(false);
    localStorage.setItem('access_token', 'fake-token');
    expect(service.isAuthenticated()).toBe(true);
  });
});
