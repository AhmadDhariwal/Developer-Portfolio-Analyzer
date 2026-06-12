import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, forkJoin } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class SuperAdminService {
  private readonly base = `${environment.apiBaseUrl}/super-admin`;

  constructor(private readonly http: HttpClient) {}

  getDashboard(): Observable<any> {
    return this.http.get(`${this.base}/dashboard`);
  }

  getDashboardBundle(params: Record<string, string> = {}): Observable<any> {
    return forkJoin({
      dashboard: this.getDashboard(),
      analytics: this.getAnalytics(params)
    });
  }

  getMetrics(): Observable<any> {
    return this.http.get(`${this.base}/metrics`);
  }

  getAnalytics(params: Record<string, string> = {}): Observable<any> {
    return this.http.get(`${this.base}/analytics`, { params });
  }

  getOrganizations(params: Record<string, string> = {}): Observable<any> {
    return this.http.get(`${this.base}/organizations`, { params });
  }

  suspendOrganization(id: string): Observable<any> {
    return this.http.patch(`${this.base}/organizations/${id}/suspend`, {});
  }

  activateOrganization(id: string): Observable<any> {
    return this.http.patch(`${this.base}/organizations/${id}/activate`, {});
  }

  getAdmins(params: Record<string, string> = {}): Observable<any> {
    return this.http.get(`${this.base}/admins`, { params });
  }

  getRecruiters(params: Record<string, string> = {}): Observable<any> {
    return this.http.get(`${this.base}/recruiters`, { params });
  }

  getDevelopers(params: Record<string, string> = {}): Observable<any> {
    return this.http.get(`${this.base}/developers`, { params });
  }

  getTeams(params: Record<string, string> = {}): Observable<any> {
    return this.http.get(`${this.base}/teams`, { params });
  }

  toggleUserActive(id: string): Observable<any> {
    return this.http.patch(`${this.base}/users/${id}/toggle-active`, {});
  }

  getUserDetails(id: string): Observable<any> {
    return this.http.get(`${this.base}/users/${id}`);
  }

  createUser(payload: Record<string, any>): Observable<any> {
    return this.http.post(`${this.base}/users`, payload);
  }

  updateUser(id: string, payload: Record<string, any>): Observable<any> {
    return this.http.patch(`${this.base}/users/${id}`, payload);
  }

  getSettings(): Observable<any> {
    return this.http.get(`${this.base}/settings`);
  }

  updateSettings(payload: Record<string, any>): Observable<any> {
    return this.http.put(`${this.base}/settings`, payload);
  }

  deleteUser(id: string): Observable<any> {
    return this.http.delete(`${this.base}/users/${encodeURIComponent(id)}`);
  }

  getRecruiterAnalytics(recruiterId: string): Observable<any> {
    return this.http.get(`${this.base}/recruiters/${recruiterId}/analytics`);
  }

  assignTeamToRecruiter(recruiterId: string, teamId: string): Observable<any> {
    return this.http.post(`${this.base}/recruiters/${recruiterId}/teams`, { teamId });
  }

  removeRecruiterTeam(recruiterId: string, teamId: string): Observable<any> {
    return this.http.delete(`${this.base}/recruiters/${recruiterId}/teams/${teamId}`);
  }
}
