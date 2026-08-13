import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { User } from './models/user.model';
import { environment } from '../../environments/environment';

interface TokenResponse {
  access_token: string;
  token_type: string;
}

const TOKEN_KEY = 'access_token';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly currentUserSubject = new BehaviorSubject<User | null>(null);
  readonly currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  login(email: string, password: string): Observable<User> {
    return this.http.post<TokenResponse>(`${environment.apiUrl}/auth/login`, { email, password }).pipe(
      tap((res) => localStorage.setItem(TOKEN_KEY, res.access_token)),
      // fetch the user profile right after storing the token
      // (kept as a separate request rather than trusting decoded JWT claims client-side)
      // eslint-disable-next-line
      (source) =>
        new Observable<User>((subscriber) => {
          source.subscribe({
            next: () => {
              this.loadCurrentUser().subscribe({
                next: (user) => {
                  if (user) subscriber.next(user);
                  subscriber.complete();
                },
                error: (err) => subscriber.error(err),
              });
            },
            error: (err) => subscriber.error(err),
          });
        })
    );
  }

  loadCurrentUser(): Observable<User | null> {
    return this.http.get<User>(`${environment.apiUrl}/auth/me`).pipe(
      tap((user) => this.currentUserSubject.next(user))
    );
  }

  changeOwnPassword(currentPassword: string, newPassword: string): Observable<User> {
    return this.http
      .patch<User>(`${environment.apiUrl}/auth/me/password`, {
        current_password: currentPassword,
        new_password: newPassword,
      })
      .pipe(tap((user) => this.currentUserSubject.next(user)));
  }

  logout(): void {
    this.http.post(`${environment.apiUrl}/auth/logout`, {}).subscribe({ error: () => {} });
    localStorage.removeItem(TOKEN_KEY);
    this.currentUserSubject.next(null);
  }

  isAuthenticated(): boolean {
    return this.getToken() !== null;
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }
}
