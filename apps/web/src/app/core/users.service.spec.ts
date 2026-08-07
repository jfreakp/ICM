import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { UsersService } from './users.service';
import { UserListItem } from './models/user-list-item.model';
import { environment } from '../../environments/environment';

describe('UsersService', () => {
  let service: UsersService;
  let httpMock: HttpTestingController;

  const sampleUser: UserListItem = {
    id: 1,
    email: 'user@example.com',
    full_name: 'Test User',
    is_admin: false,
    is_active: true,
    allowed_ip: '10.0.0.5',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [UsersService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(UsersService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('listUsers fetches the user list', () => {
    let result: UserListItem[] | undefined;
    service.listUsers().subscribe((users) => (result = users));

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/users`);
    expect(req.request.method).toBe('GET');
    req.flush([sampleUser]);

    expect(result).toEqual([sampleUser]);
  });

  it('updateAllowedIp PATCHes the allowed IP and returns the updated user', () => {
    let result: UserListItem | undefined;
    service.updateAllowedIp(1, null).subscribe((user) => (result = user));

    const req = httpMock.expectOne(`${environment.apiUrl}/auth/users/1/allowed-ip`);
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ allowed_ip: null });
    req.flush({ ...sampleUser, allowed_ip: null });

    expect(result?.allowed_ip).toBeNull();
  });
});
