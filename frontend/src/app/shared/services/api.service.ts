import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  /* ── Auth ── */
  register(userData: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/register`, userData);
  }

  login(credentials: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/login`, credentials);
  }

  /* ── Career Profile ── */
  updateCareerProfile(careerStack: string, experienceLevel: string, careerGoal?: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/profile/career`, { careerStack, experienceLevel, careerGoal });
  }

  /* ── GitHub / Resume / Analysis ── */
  analyzeGitHub(username: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/github/analyze`, { username });
  }

  uploadResume(formData: FormData): Observable<any> {
    return this.http.post(`${this.baseUrl}/resume/upload`, formData);
  }

  analyzeResume(fileId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/resume/analyze`, { fileId });
  }

  getResumeAnalysis(): Observable<any> {
    return this.http.get(`${this.baseUrl}/resume/result`);
  }

  getResumeFiles(): Observable<any> {
    return this.http.get(`${this.baseUrl}/resume/files`);
  }

  getActiveResumeContext(): Observable<any> {
    return this.http.get(`${this.baseUrl}/resume/active`);
  }

  setActiveResume(fileId: string, setAsDefault = false): Observable<any> {
    return this.http.put(`${this.baseUrl}/resume/active`, { fileId, setAsDefault });
  }

  downloadResumeGuide(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/resume/guide`, { responseType: 'blob' });
  }

  /* ── AI Analysis (career-profile-aware) ── */
  getSkillGap(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    resumeText?:     string
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/skillgap/skill-gap`, {
      username, careerStack, experienceLevel, resumeText
    });
  }

  getRecommendations(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    knownSkills?:    string[],
    missingSkills?:  string[]
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/recommendations`, {
      username, careerStack, experienceLevel, knownSkills, missingSkills
    });
  }

  getPortfolioScore(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    resumeAnalysis:  any,
    githubAnalysis:  any,
    resumeText?:     string
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/analysis/portfolio-score`, {
      username, careerStack, experienceLevel, resumeAnalysis, githubAnalysis, resumeText
    });
  }

  /* ── Dashboard ── */
  getDashboardSummary(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/summary`);
  }

  getDashboardContributions(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/contributions`);
  }

  getDashboardLanguages(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/languages`);
  }

  /* ── Audit Logs ── */
  getAuditLogs(params: {
    actor?: string;
    action?: string;
    organizationId?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  } = {}): Observable<any> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });
    const suffix = query.toString();
    const endpoint = suffix ? `${this.baseUrl}/audit-logs?${suffix}` : `${this.baseUrl}/audit-logs`;
    return this.http.get(endpoint);
  }

  /* ── Workflow Engine ── */
  startWorkflow(payload: {
    pipeline: 'github_only' | 'resume_only' | 'combined' | 'deep_scan';
    username?: string;
    resumeText?: string;
    fileName?: string;
    fileSize?: number;
    maxRetriesPerStep?: number;
    retryDelayMs?: number;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/workflows`, payload);
  }

  getWorkflows(page = 1, limit = 10, pipeline = ''): Observable<any> {
    const query = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (pipeline) query.set('pipeline', pipeline);
    return this.http.get(`${this.baseUrl}/workflows?${query.toString()}`);
  }

  getWorkflowById(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/workflows/${id}`);
  }

  /* ── AI Versions ── */
  getAiVersions(options: { source?: string; includeOutput?: boolean; limit?: number } = {}): Observable<any> {
    const query = new URLSearchParams();
    if (options.source) query.set('source', options.source);
    if (options.includeOutput) query.set('includeOutput', 'true');
    if (options.limit) query.set('limit', String(options.limit));
    const suffix = query.toString();
    const endpoint = suffix ? `${this.baseUrl}/ai-versions?${suffix}` : `${this.baseUrl}/ai-versions`;
    return this.http.get(endpoint);
  }

  createAiVersion(payload: { source?: string; outputJson: Record<string, unknown>; metadata?: Record<string, unknown> }): Observable<any> {
    return this.http.post(`${this.baseUrl}/ai-versions`, payload);
  }

  compareAiVersions(id: string, compareId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/ai-versions/${id}/compare/${compareId}`);
  }

  rollbackAiVersion(id: string, source = ''): Observable<any> {
    return this.http.post(`${this.baseUrl}/ai-versions/${id}/rollback`, { source });
  }

  /* ── Multi-Tenant Teams ── */
  createOrganization(payload: { name: string; slug?: string; description?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/tenant/organizations`, payload);
  }

  getOrganizations(): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/organizations`);
  }

  createTeam(organizationId: string, payload: { name: string; slug?: string; description?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/tenant/organizations/${organizationId}/teams`, payload);
  }

  getTeams(organizationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/organizations/${organizationId}/teams`);
  }

  inviteUser(organizationId: string, payload: { email: string; role: 'admin' | 'manager' | 'member'; teamId?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/tenant/organizations/${organizationId}/invitations`, payload);
  }

  getInvitations(organizationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/organizations/${organizationId}/invitations`);
  }

  revokeInvitation(organizationId: string, invitationId: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/tenant/organizations/${organizationId}/invitations/${invitationId}/revoke`, {});
  }

  acceptInvitation(invitationId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/tenant/invitations/${invitationId}/accept`, {});
  }

  acceptInvitationByToken(token: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/tenant/invitations/accept/${encodeURIComponent(token)}`, {});
  }

  getInvitationDetailsByToken(token: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/invitations/${encodeURIComponent(token)}/details`);
  }

  acceptInvitationOnboard(token: string, payload: { name: string; password: string; githubUsername?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/tenant/invitations/accept/${encodeURIComponent(token)}/onboard`, payload);
  }

  getOrganizationMembers(organizationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/organizations/${organizationId}/members`);
  }

  getTeamMembers(teamId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/teams/${teamId}/members`);
  }

  updateMembershipRole(membershipId: string, role: 'admin' | 'manager' | 'member'): Observable<any> {
    return this.http.patch(`${this.baseUrl}/tenant/memberships/${membershipId}/role`, { role });
  }

  getTeamSharedDashboard(teamId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/teams/${teamId}/shared-dashboard`);
  }

  getTeamAnalytics(teamId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/teams/${teamId}/analytics`);
  }
}
