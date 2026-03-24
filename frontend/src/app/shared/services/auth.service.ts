import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { TenantContextService } from './tenant-context.service';

const SESSION_DURATION_MS = 20 * 60 * 60 * 1000; // 20 hours
const CAREER_PROFILE_STORAGE_KEY = 'devinsight_career_profile';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly baseUrl = 'http://localhost:5000/api';
  private readonly isLoggedInSubject = new BehaviorSubject<boolean>(this.checkToken());
  isLoggedIn$ = this.isLoggedInSubject.asObservable();
  private autoLogoutTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly http: HttpClient, private readonly router: Router, private readonly tenantContext: TenantContextService) {
    if (this.checkToken()) {
      this.scheduleAutoLogout();
      // Restore role from stored user on page refresh
      const user = this.getCurrentUser();
      if (user?.role === 'admin') {
        this.tenantContext.setOrganization({ id: 'local', name: 'local', myRole: 'admin' });
      }
    }
  }

  private checkToken(): boolean {
    const token = localStorage.getItem('token');
    if (!token) return false;

    // Reject legacy/malformed tokens early so stale sessions do not keep reconnecting SSE.
    const parts = token.split('.');
    if (parts.length !== 3) {
      this.clearStorage();
      return false;
    }

    try {
      const normalized = parts[1].replaceAll('-', '+').replaceAll('_', '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const payloadRaw = atob(padded);
      const payload = JSON.parse(payloadRaw) as { exp?: number; iss?: string; aud?: string | string[] };

      const expectedIssuer = 'devinsight-api';
      const expectedAudience = 'devinsight-web';
      const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud].filter(Boolean);

      if (!payload.exp || payload.exp * 1000 <= Date.now()) {
        this.clearStorage();
        return false;
      }

      if (payload.iss !== expectedIssuer || !audList.includes(expectedAudience)) {
        this.clearStorage();
        return false;
      }
    } catch {
      this.clearStorage();
      return false;
    }

    const expiry = localStorage.getItem('loginExpiry');
    if (expiry && Date.now() > Number.parseInt(expiry, 10)) {
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
    const remaining = Number.parseInt(expiry, 10) - Date.now();
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
    const careerProfile = {
      careerStack: response.activeCareerStack || response.careerStack || 'Full Stack',
      experienceLevel: response.activeExperienceLevel || response.experienceLevel || 'Student',
      careerGoal: response.careerGoal || '',
      isConfigured: true
    };
    localStorage.setItem(CAREER_PROFILE_STORAGE_KEY, JSON.stringify(careerProfile));
    localStorage.setItem('loginExpiry', String(Date.now() + SESSION_DURATION_MS));
    // Set role in tenant context so sidebar and guards work correctly
    if (response.role === 'admin') {
      this.tenantContext.setOrganization({ id: 'local', name: 'local', myRole: 'admin' });
    } else {
      this.tenantContext.setOrganization({ id: 'local', name: 'local', myRole: 'member' });
    }
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

  completeExternalLogin(authPayload: any): void {
    if (!authPayload?.token) return;
    this.storeSession(authPayload);
  }

  logout(): void {
    if (this.autoLogoutTimer) {
      clearTimeout(this.autoLogoutTimer);
      this.autoLogoutTimer = null;
    }
    this.clearStorage();
    localStorage.removeItem(CAREER_PROFILE_STORAGE_KEY);
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
      } catch {
        return null;
      }
    }
    return null;
  }

  isLoggedIn(): boolean {
    return this.checkToken();
  }
}
