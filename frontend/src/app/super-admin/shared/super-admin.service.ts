import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SuperAdminService {
  private readonly base = 'http://localhost:5000/api/super-admin';

  constructor(private readonly http: HttpClient) {}

  getDashboard(): Observable<any> {
    return this.http.get(`${this.base}/dashboard`);
  }

  getMetrics(): Observable<any> {
    return this.http.get(`${this.base}/metrics`);
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
}
