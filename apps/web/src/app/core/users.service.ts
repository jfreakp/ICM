import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { UserListItem } from './models/user-list-item.model';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class UsersService {
  private readonly http = inject(HttpClient);

  listUsers(): Observable<UserListItem[]> {
    return this.http.get<UserListItem[]>(`${environment.apiUrl}/auth/users`);
  }

  updateAllowedIp(id: number, allowedIp: string | null): Observable<UserListItem> {
    return this.http.patch<UserListItem>(`${environment.apiUrl}/auth/users/${id}/allowed-ip`, {
      allowed_ip: allowedIp,
    });
  }
}
