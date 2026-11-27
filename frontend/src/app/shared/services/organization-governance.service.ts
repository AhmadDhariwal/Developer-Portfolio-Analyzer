import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  OrganizationCapabilities,
  OrganizationConfiguration,
  OrganizationConfigurationPatch,
  OrganizationDirectoryMember,
  OrganizationGovernance,
  OrganizationInvitation,
  OrganizationInvitationStatus,
} from '../models/organization-governance.model';

@Injectable({ providedIn: 'root' })
export class OrganizationGovernanceService {
  private readonly base = `${environment.apiBaseUrl}/admin-console`;

  constructor(private readonly http: HttpClient) {}

  getGovernance(): Observable<OrganizationGovernance> {
    return this.http.get<OrganizationGovernance>(`${this.base}/governance`);
  }

  updateGovernance(patch: OrganizationConfigurationPatch): Observable<OrganizationConfiguration> {
    return this.http.patch<OrganizationConfiguration>(`${this.base}/governance`, patch);
  }

  getCapabilities(audience: 'admin' | 'recruiter'): Observable<OrganizationCapabilities> {
    const base = audience === 'admin' ? this.base : `${environment.apiBaseUrl}/recruiter-hub`;
    return this.http.get<OrganizationCapabilities>(`${base}/capabilities`);
  }

  getMembers(): Observable<{
    members: OrganizationDirectoryMember[];
    total: number;
    publicDevelopersIncluded: false;
  }> {
    return this.http.get<{
      members: OrganizationDirectoryMember[];
      total: number;
      publicDevelopersIncluded: false;
    }>(`${this.base}/members`);
  }

  getInvitations(
    status?: OrganizationInvitationStatus,
  ): Observable<{ invitations: OrganizationInvitation[] }> {
    return this.http.get<{ invitations: OrganizationInvitation[] }>(`${this.base}/invitations`, {
      params: status ? { status } : {},
    });
  }
}
