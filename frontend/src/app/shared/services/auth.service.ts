import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap, map } from 'rxjs/operators';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly baseUrl = 'http://localhost:5000/api';
  private isLoggedInSubject = new BehaviorSubject<boolean>(this.checkToken());
  isLoggedIn$ = this.isLoggedInSubject.asObservable();

  constructor(private readonly http: HttpClient) {
    // Check token on service init
    this.isLoggedInSubject.next(this.checkToken());
  }

  private checkToken(): boolean {
    const token = localStorage.getItem('token');
    return !!token;
  }

  /**
   * Register a new user
   */
  register(userData: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/register`, userData).pipe(
      tap((response: any) => {
        if (response.token) {
          localStorage.setItem('token', response.token);
          localStorage.setItem('user', JSON.stringify(response));
          this.isLoggedInSubject.next(true);
        }
      })
    );
  }

  /**
   * Login user
   */
  login(credentials: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/login`, credentials).pipe(
      tap((response: any) => {
        if (response.token) {
          localStorage.setItem('token', response.token);
          localStorage.setItem('user', JSON.stringify(response));
          this.isLoggedInSubject.next(true);
        }
      })
    );
  }

  /**
   * Logout user — clear all stored data
   */
  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.isLoggedInSubject.next(false);
  }

  /**
   * Get auth token
   */
  getToken(): string | null {
    return localStorage.getItem('token');
  }

  /**
   * Get current user
   */
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

  /**
   * Check if user is logged in (synchronous)
   */
  isLoggedIn(): boolean {
    return this.checkToken();
  }
}
