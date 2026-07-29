import { Injectable, OnDestroy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { TenantContextService } from './tenant-context.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';
import { environment } from '../../../environments/environment';

const SESSION_DURATION_MS = 20 * 60 * 60 * 1000; // 20 hours
const CAREER_PROFILE_STORAGE_KEY = 'devinsight_career_profile';
const RESUME_ANALYSIS_CACHE_PREFIX = 'resume_analysis_cache:';
// Fire logout 60 seconds before actual JWT expiry so network latency doesn't leave
// the user in a state where the token is expired but the timer hasn't fired yet.
const EXPIRY_BUFFER_MS = 60_000;

export interface SessionUser {
  _id?: string;
  name?: string;
  email?: string;
  role?: string;
  githubUsername?: string;
  activeGithubUsername?: string;
  avatar?: string;
  careerStack?: string;
  experienceLevel?: string;
  activeCareerStack?: string;
  activeExperienceLevel?: string;
  careerGoal?: string;
  token?: string;
  [key: string]: unknown;
}

export type OtpType = 'email' | 'phone';
export type OtpPurpose = 'signup' | 'forgot-password';

const normalizeRole = (role: unknown): string => {
  const value = String(role || '').trim().toLowerCase();
  if (value === 'user' || value === 'guest') return 'developer';
  if (value === 'super-admin' || value === 'superadmin') return 'super_admin';
  return value;
};

@Injectable({
  providedIn: 'root'
})
export class AuthService implements OnDestroy {
  private readonly baseUrl = environment.apiBaseUrl;
  private readonly apiOrigin = environment.apiOrigin;
  // Capture whether a raw token existed before checkToken() may clear it.
  // This lets the constructor detect the "expired token at startup" case.
  private readonly hadTokenOnStartup = !!localStorage.getItem('token');
  private readonly isLoggedInSubject = new BehaviorSubject<boolean>(this.checkToken());
  isLoggedIn$ = this.isLoggedInSubject.asObservable();
  private readonly currentUserSubject = new BehaviorSubject<SessionUser | null>(this.readStoredUser());
  currentUser$ = this.currentUserSubject.asObservable();
  private readonly avatarVersionSubject = new BehaviorSubject<number>(Date.now());
  avatarVersion$ = this.avatarVersionSubject.asObservable();
  private autoLogoutTimer: ReturnType<typeof setTimeout> | null = null;
  private isLoggingOut = false;
  // Kept for cleanup in ngOnDestroy so we avoid memory leaks
  private readonly boundStorageHandler: (e: StorageEvent) => void;
  private readonly boundVisibilityHandler: () => void;

  constructor(private readonly http: HttpClient, private readonly router: Router, private readonly tenantContext: TenantContextService, private readonly cacheInvalidation: FrontendCacheInvalidationService) {
    // Cross-tab logout sync: when another tab clears the 'token' key from localStorage,
    // this tab gets a 'storage' event and immediately logs out without a page reload.
    this.boundStorageHandler = (e: StorageEvent) => {
      if (e.key === 'token' && !e.newValue && this.isLoggedInSubject.value) {
        // Another tab logged out — mirror it here silently (no redirect loop needed if
        // the current tab is already navigated by the other tab's action).
        this.logout(true);
      }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('storage', this.boundStorageHandler);
    }

    // Visibility / focus recheck: devices may suspend JavaScript timers during sleep.
    // When the user returns to the tab after the device was asleep, re-validate the session.
    this.boundVisibilityHandler = () => {
      if (document.visibilityState === 'visible' || document.hasFocus()) {
        if (!this.checkToken() && this.isLoggedInSubject.value) {
          this.logout(true);
        } else if (this.checkToken()) {
          // Token is still valid — reschedule timer in case it drifted
          this.scheduleAutoLogout();
        }
      }
    };
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityHandler);
      window.addEventListener('focus', this.boundVisibilityHandler);
    }

    if (this.checkToken()) {
      this.scheduleAutoLogout();
      // Restore role from stored user on page refresh — use real org id if present
      const user = this.getCurrentUser();
      if (user?.role === 'admin') {
        const orgId = String(user['organizationId'] || '');
        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(orgId);
        this.tenantContext.setOrganization({
          id: isValidObjectId ? orgId : '',
          name: String(user['organizationName'] || ''),
          myRole: 'admin'
        });
      } else if (user?.role === 'recruiter') {
        const orgId = String(user['organizationId'] || '');
        const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(orgId);
        if (isValidObjectId) {
          this.tenantContext.setOrganization({
            id: orgId,
            name: String(user['organizationName'] || ''),
            myRole: 'recruiter'
          });
        }
      } else if (normalizeRole(user?.role) === 'super_admin') {
        this.tenantContext.clearAll();
      }
    } else if (this.hadTokenOnStartup) {
      // If a token existed in storage but was expired or invalid, checkToken() cleared storage.
      // Ensure user is redirected to login if on protected route
      const currentPath = typeof window !== 'undefined' ? (window.location.pathname + window.location.search) : '';
      if (currentPath && !currentPath.startsWith('/auth/')) {
        this.logout(true, currentPath);
      }
    }
  }

  ngOnDestroy(): void {
    // Clean up all listeners and timers to prevent memory leaks.
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', this.boundStorageHandler);
      window.removeEventListener('focus', this.boundVisibilityHandler);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityHandler);
    }
    if (this.autoLogoutTimer) {
      clearTimeout(this.autoLogoutTimer);
      this.autoLogoutTimer = null;
    }
  }

  private getJwtExpMs(token?: string | null): number | null {
    const rawToken = token || localStorage.getItem('token');
    if (!rawToken) return null;
    const parts = rawToken.split('.');
    if (parts.length !== 3) return null;

    try {
      const normalized = parts[1].replaceAll('-', '+').replaceAll('_', '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const payloadRaw = atob(padded);
      const payload = JSON.parse(payloadRaw) as { exp?: number };
      return payload.exp ? payload.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  private getEarliestExpiryTimestamp(): number | null {
    const jwtExp = this.getJwtExpMs();
    const expiryStr = localStorage.getItem('loginExpiry');
    const loginExp = expiryStr ? Number.parseInt(expiryStr, 10) : null;

    if (jwtExp !== null && loginExp !== null) {
      return Math.min(jwtExp, loginExp);
    }
    return jwtExp ?? loginExp;
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
    Object.keys(localStorage)
      .filter((key) => key.startsWith(RESUME_ANALYSIS_CACHE_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
    this.currentUserSubject?.next(null);
  }

  private readStoredUser(): SessionUser | null {
    const userStr = localStorage.getItem('user');
    if (!userStr) return null;

    try {
      const parsed = JSON.parse(userStr);
      if (!parsed || typeof parsed !== 'object') return null;
      return {
        ...(parsed as SessionUser),
        avatar: this.normalizeAvatarUrl(String((parsed as SessionUser).avatar || ''))
      };
    } catch {
      return null;
    }
  }

  private persistCurrentUser(user: SessionUser | null): void {
    if (user) {
      const normalized = {
        ...user,
        avatar: this.normalizeAvatarUrl(String(user.avatar || ''))
      };
      localStorage.setItem('user', JSON.stringify(normalized));
      this.currentUserSubject.next(normalized);
      return;
    } else {
      localStorage.removeItem('user');
    }

    this.currentUserSubject.next(user);
  }

  private normalizeAvatarUrl(avatar: string): string {
    const raw = String(avatar || '').trim();
    if (!raw) return '';

    if (/^data:/i.test(raw) || raw.startsWith('blob:')) return raw;

    const browserOrigin = typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : this.apiOrigin;

    if (/^https?:\/\//i.test(raw)) {
      try {
        const parsed = new URL(raw);
        if (parsed.pathname.startsWith('/uploads/')) {
          // Strip query params when storing — cache-busting ?v= is added at display time
          return `${browserOrigin}${parsed.pathname}`;
        }
      } catch {
        return raw;
      }
      return raw;
    }

    if (raw.startsWith('//')) {
      const protocol = globalThis.location?.protocol || 'https:';
      return `${protocol}${raw}`;
    }

    if (raw.startsWith('/uploads/')) {
      return `${browserOrigin}${raw}`;
    }

    if (raw.startsWith('uploads/')) {
      return `${browserOrigin}/${raw}`;
    }

    return raw;
  }

  private scheduleAutoLogout(): void {
    if (this.autoLogoutTimer) {
      clearTimeout(this.autoLogoutTimer);
      this.autoLogoutTimer = null;
    }

    const expiryMs = this.getEarliestExpiryTimestamp();
    if (!expiryMs) return;

    // Apply a 60-second safety buffer so the timer fires slightly before actual expiry,
    // ensuring the session is cleared before the next API call would 401.
    const remaining = expiryMs - Date.now() - EXPIRY_BUFFER_MS;
    if (remaining <= 0) {
      this.logout(true);
      return;
    }

    this.autoLogoutTimer = setTimeout(() => {
      this.logout(true);
    }, remaining);
  }

  private storeSession(response: any): void {
    this.isLoggingOut = false;
    if (this.autoLogoutTimer) {
      clearTimeout(this.autoLogoutTimer);
      this.autoLogoutTimer = null;
    }
    this.cacheInvalidation.clearAllUserCaches();
    localStorage.setItem('token', response.token);
    this.persistCurrentUser({ ...response, avatar: response.avatar || '' } as SessionUser);
    const careerProfile = {
      careerStack: response.activeCareerStack || response.careerStack || 'Full Stack',
      experienceLevel: response.activeExperienceLevel || response.experienceLevel || 'Student',
      careerGoal: response.careerGoal || '',
      isConfigured: true
    };
    localStorage.setItem(CAREER_PROFILE_STORAGE_KEY, JSON.stringify(careerProfile));

    const jwtExp = this.getJwtExpMs(response.token);
    const fallbackExpiry = Date.now() + SESSION_DURATION_MS;
    const loginExpiry = jwtExp ? Math.min(jwtExp, fallbackExpiry) : fallbackExpiry;
    localStorage.setItem('loginExpiry', String(loginExpiry));

    // Set tenant context using the real organizationId from the server response.
    // Only fall back to a placeholder when no real org is available yet.
    const orgId = String(response.organizationId || '');
    const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(orgId);

    if (normalizeRole(response.role) === 'super_admin') {
      this.tenantContext.clearAll();
    } else if (response.role === 'admin') {
      // Admin: use real org id if available, otherwise leave empty so the
      // backend resolves it from the Organization collection (avoids "local" cast error)
      this.tenantContext.setOrganization({
        id: isValidObjectId ? orgId : '',
        name: response.organizationName || '',
        myRole: 'admin'
      });
    } else if (response.role === 'recruiter' && isValidObjectId) {
      this.tenantContext.setOrganization({
        id: orgId,
        name: response.organizationName || '',
        myRole: 'recruiter'
      });
    } else {
      // Developer / member — no org context needed on the frontend
      this.tenantContext.setOrganization({ id: '', name: '', myRole: 'member' });
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

  sendOtp(payload: {
    userId?: string;
    email?: string;
    phoneNumber?: string;
    countryCode?: string;
    type: OtpType;
    purpose: OtpPurpose;
  }): Observable<{ message: string; userId: string; expiresAt?: string }> {
    return this.http.post<{ message: string; userId: string; expiresAt?: string }>(`${this.baseUrl}/auth/send-otp`, payload);
  }

  verifyOtp(payload: {
    userId?: string;
    pendingId?: string;
    otp: string;
    type: OtpType;
    purpose: OtpPurpose;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/verify-otp`, payload).pipe(
      tap((response: any) => {
        if (response?.token) this.storeSession(response);
      })
    );
  }

  forgotPassword(payload: {
    email?: string;
    phoneNumber?: string;
    countryCode?: string;
    type: OtpType;
  }): Observable<{ message: string; userId: string; expiresAt?: string }> {
    return this.http.post<{ message: string; userId: string; expiresAt?: string }>(`${this.baseUrl}/auth/forgot-password`, payload);
  }

  resetPassword(payload: { resetToken: string; newPassword: string }): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${this.baseUrl}/auth/reset-password`, payload);
  }

  completeExternalLogin(authPayload: any): void {
    if (!authPayload?.token) return;
    this.storeSession(authPayload);
  }

  startExternalLogin(provider: 'google' | 'github'): void {
    window.location.assign(`${this.baseUrl}/auth/${provider}`);
  }

  logout(redirect: boolean = true, customReturnUrl?: string): void {
    if (this.isLoggingOut) return;
    this.isLoggingOut = true;

    try {
      if (this.autoLogoutTimer) {
        clearTimeout(this.autoLogoutTimer);
        this.autoLogoutTimer = null;
      }
      this.cacheInvalidation.clearAllUserCaches();
      this.clearStorage();
      localStorage.removeItem(CAREER_PROFILE_STORAGE_KEY);
      this.tenantContext.clearAll();
      this.isLoggedInSubject.next(false);

      if (redirect) {
        const rawUrl = customReturnUrl || (typeof this.router !== 'undefined' ? this.router.url : '');
        const isAuthPage = rawUrl.startsWith('/auth/');
        if (!isAuthPage && rawUrl) {
          this.router.navigate(['/auth/login'], {
            queryParams: { returnUrl: rawUrl, expired: 'true' }
          });
        } else if (!this.router.url?.includes('/auth/login')) {
          this.router.navigate(['/auth/login']);
        }
      }
    } finally {
      setTimeout(() => {
        this.isLoggingOut = false;
      }, 0);
    }
  }

  getToken(): string | null {
    return localStorage.getItem('token');
  }

  getCurrentUser(): SessionUser | null {
    return this.currentUserSubject.value ?? this.readStoredUser();
  }

  updateCurrentUser(partial: Partial<SessionUser>): void {
    const current = this.currentUserSubject.value ?? this.readStoredUser();
    if (!current) return;

    const updated = {
      ...current,
      ...partial
    } as SessionUser;

    // Bump avatar version if avatar changed
    if (partial.avatar && partial.avatar !== current.avatar) {
      this.avatarVersionSubject.next(Date.now());
    }

    this.persistCurrentUser(updated);
  }

  getAvatarVersion(): number {
    return this.avatarVersionSubject.value;
  }

  isLoggedIn(): boolean {
    return this.checkToken();
  }

  getHomeRoute(user: SessionUser | null = this.getCurrentUser()): string {
    const role = normalizeRole(user?.role);

    switch (role) {
      case 'super_admin':
        return '/app/super-admin/dashboard';
      case 'admin':
        return '/app/admin/dashboard';
      case 'recruiter':
        return '/app/recruiter/dashboard';
      case 'developer':
      default:
        return '/app/dashboard';
    }
  }

  canAccessUrl(url: string, user: SessionUser | null = this.getCurrentUser()): boolean {
    const target = String(url || '').trim();
    if (!target) return false;

    const role = normalizeRole(user?.role);
    if (role === 'super_admin') {
      return target.startsWith('/super-admin') || target.startsWith('/app/super-admin');
    }

    if (role === 'admin') {
      return target.startsWith('/app/admin') || target.startsWith('/app/admin-console');
    }

    if (role === 'recruiter') {
      return target.startsWith('/app/recruiter');
    }

    return !(
      target.startsWith('/app/recruiter') ||
      target.startsWith('/app/admin') ||
      target.startsWith('/app/admin-console') ||
      target.startsWith('/super-admin') ||
      target.startsWith('/app/super-admin')
    );
  }
}

