import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Router } from '@angular/router';

const SESSION_DURATION_MS = 20 * 60 * 60 * 1000; // 20 hours

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly baseUrl = 'http://localhost:5000/api';
  private isLoggedInSubject = new BehaviorSubject<boolean>(this.checkToken());
  isLoggedIn$ = this.isLoggedInSubject.asObservable();
  private autoLogoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly http: HttpClient, private readonly router: Router) {
    if (this.checkToken()) {
      this.scheduleAutoLogout();
    }
  }

  private checkToken(): boolean {
    const token = localStorage.getItem('token');
    if (!token) return false;
    const expiry = localStorage.getItem('loginExpiry');
    if (expiry && Date.now() > parseInt(expiry, 10)) {
      this.clearStorage();
      return false;
    }
    return true;
  }

  private clearStorage(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('loginExpiry');
  }

  private scheduleAutoLogout(): void {
    const expiry = localStorage.getItem('loginExpiry');
    if (!expiry) return;
    const remaining = parseInt(expiry, 10) - Date.now();
    if (remaining <= 0) {
      this.logout();
      this.router.navigate(['/auth/login']);
      return;
    }
    if (this.autoLogoutTimer) clearTimeout(this.autoLogoutTimer);
    this.autoLogoutTimer = setTimeout(() => {
      this.logout();
      this.router.navigate(['/auth/login']);
    }, remaining);
  }

  private storeSession(response: any): void {
    localStorage.setItem('token', response.token);
    localStorage.setItem('user', JSON.stringify(response));
    localStorage.setItem('loginExpiry', String(Date.now() + SESSION_DURATION_MS));
    this.isLoggedInSubject.next(true);
    this.scheduleAutoLogout();
  }

  register(userData: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/register`, userData).pipe(
      tap((response: any) => {
        if (response.token) this.storeSession(response);
      })
    );
  }

  login(credentials: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/login`, credentials).pipe(
      tap((response: any) => {
        if (response.token) this.storeSession(response);
      })
    );
  }

  logout(): void {
    if (this.autoLogoutTimer) {
      clearTimeout(this.autoLogoutTimer);
      this.autoLogoutTimer = null;
    }
    this.clearStorage();
    this.isLoggedInSubject.next(false);
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getCurrentUser(): any {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      try {
        return JSON.parse(userStr);
      } catch (e) {
        return null;
      }
    }
    return null;
  }

  isLoggedIn(): boolean {
    return this.checkToken();
  }
}
