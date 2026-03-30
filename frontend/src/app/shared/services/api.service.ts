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

  getDashboardIntegrationAnalytics(days = 7): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/integration-analytics?days=${encodeURIComponent(String(days))}`);
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

  deleteAuditLog(id: string, params: { organizationId?: string } = {}): Observable<any> {
    const query = new URLSearchParams();
    if (params.organizationId) query.set('organizationId', params.organizationId);
    const suffix = query.toString();
    const endpoint = suffix ? `${this.baseUrl}/audit-logs/${id}?${suffix}` : `${this.baseUrl}/audit-logs/${id}`;
    return this.http.delete(endpoint);
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
  getAiVersions(options: { source?: string; includeOutput?: boolean; limit?: number; page?: number } = {}): Observable<any> {
    const query = new URLSearchParams();
    if (options.source) query.set('source', options.source);
    if (options.includeOutput) query.set('includeOutput', 'true');
    if (options.limit) query.set('limit', String(options.limit));
    if (options.page) query.set('page', String(options.page));
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

  deleteAiVersion(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/ai-versions/${id}`);
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

  triggerIntegrationSync(provider?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/integrations/sync-now`, provider ? { provider } : {});
  }

  runWhatIfSimulation(payload: {
    baselineHiringScore: number;
    baselineJobMatch: number;
    skills: string[];
    projects: Array<{ name: string; impact: number; complexity: 'low' | 'medium' | 'high'; weeks: number }>;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/simulator/what-if`, payload);
  }

  /* ── Public Profiles ── */
  getPublicProfile(slug: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/public-profiles/${encodeURIComponent(slug)}`);
  }

  getMyPublicProfile(): Observable<any> {
    return this.http.get(`${this.baseUrl}/public-profiles/me`);
  }

  updateMyPublicProfile(payload: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/public-profiles/me`, payload);
  }

  getPublicProfileAnalytics(): Observable<any> {
    return this.http.get(`${this.baseUrl}/public-profiles/me/analytics`);
  }

  /* ── Recruiter Dashboard ── */
  getRecruiterCandidates(params: { search?: string; minScore?: number; skills?: string[]; limit?: number } = {}): Observable<any> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.minScore !== undefined) query.set('minScore', String(params.minScore));
    if (params.skills?.length) query.set('skills', params.skills.join(','));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    return this.http.get(`${this.baseUrl}/recruiter/candidates${suffix ? `?${suffix}` : ''}`);
  }

  /* ── Weekly AI Reports ── */
  generateWeeklyReport(): Observable<any> {
    return this.http.post(`${this.baseUrl}/weekly-reports/generate`, {});
  }

  getWeeklyReportLatest(): Observable<any> {
    return this.http.get(`${this.baseUrl}/weekly-reports/latest`);
  }

  getWeeklyReportHistory(limit = 6): Observable<any> {
    return this.http.get(`${this.baseUrl}/weekly-reports/history?limit=${encodeURIComponent(String(limit))}`);
  }

  /* ── Interview Prep ── */
  generateInterviewPrep(payload: { skillGaps: string[]; careerStack?: string; experienceLevel?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/interview-prep`, payload);
  }

  getInterviewPrepQuestions(params: { skill: string; page?: number; limit?: number; difficulty?: string; tags?: string[] }): Observable<any> {
    const query = new URLSearchParams();
    query.set('skill', params.skill);
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 20));
    if (params.difficulty) query.set('difficulty', params.difficulty);
    if (params.tags?.length) query.set('tags', params.tags.join(','));
    return this.http.get(`${this.baseUrl}/interview-prep/questions?${query.toString()}`);
  }

  searchInterviewPrepQuestions(params: { q: string; page?: number; limit?: number; skill?: string; difficulty?: string; tags?: string[] }): Observable<any> {
    const query = new URLSearchParams();
    query.set('q', params.q);
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 20));
    if (params.skill) query.set('skill', params.skill);
    if (params.difficulty) query.set('difficulty', params.difficulty);
    if (params.tags?.length) query.set('tags', params.tags.join(','));
    return this.http.get(`${this.baseUrl}/interview-prep/search?${query.toString()}`);
  }

  generateInterviewPrepQuestions(payload: { skill: string; query?: string; page?: number; limit?: number }): Observable<any> {
    return this.http.post(`${this.baseUrl}/interview-prep/generate`, payload);
  }

  getInterviewPrepHistory(limit = 5): Observable<any> {
    return this.http.get(`${this.baseUrl}/interview-prep/history?limit=${encodeURIComponent(String(limit))}`);
  }

  /* ── Career Sprint ── */
  getCurrentCareerSprint(): Observable<any> {
    return this.http.get(`${this.baseUrl}/career-sprints/current`);
  }

  createCareerSprint(payload: { title?: string; weeklyGoal?: number; tasks?: Array<{ title: string; description?: string; points?: number }> }): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints`, payload);
  }

  addCareerSprintTask(sprintId: string, payload: { title: string; description?: string; points?: number }): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints/${sprintId}/tasks`, payload);
  }

  updateCareerSprintTask(sprintId: string, taskId: string, isCompleted: boolean): Observable<any> {
    return this.http.put(`${this.baseUrl}/career-sprints/${sprintId}/tasks/${taskId}`, { isCompleted });
  }

  getCareerSprintHistory(limit = 6): Observable<any> {
    return this.http.get(`${this.baseUrl}/career-sprints/history?limit=${encodeURIComponent(String(limit))}`);
  }
}
