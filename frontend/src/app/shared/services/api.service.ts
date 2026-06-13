import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = environment.apiBaseUrl;
  private scenarioContextCache: any | null = null;
  private scenarioHistoryCache = new Map<number, any>();

  constructor(
    private readonly http: HttpClient,
    private readonly frontendCache: FrontendAnalysisCacheService
  ) {}

  /* ── Auth ── */
  register(userData: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/register`, userData);
  }

  login(credentials: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/login`, credentials);
  }

  getAuthInviteDetails(token: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/auth/invite-details/${encodeURIComponent(token)}`);
  }

  acceptAuthInvite(payload: {
    token: string;
    name: string;
    password?: string;
    githubUsername?: string;
    linkedin?: string;
    phoneNumber?: string;
    countryCode?: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/accept-invite`, payload);
  }

  /* ── Career Profile ── */
  updateCareerProfile(careerStack: string, experienceLevel: string, careerGoal?: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/profile/career`, { careerStack, experienceLevel, careerGoal }).pipe(
      tap(() => this.invalidateDeveloperSignalState())
    );
  }

  /* ── GitHub / Resume / Analysis ── */
  analyzeGitHub(username: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/github/analyze`, { username }).pipe(
      tap(() => this.invalidateDeveloperSignalState())
    );
  }

  uploadResume(formData: FormData): Observable<any> {
    return this.http.post(`${this.baseUrl}/resume/upload`, formData).pipe(
      tap(() => this.invalidateDeveloperSignalState())
    );
  }

  analyzeResume(fileId: string, forceRefresh = false): Observable<any> {
    return this.http.post(`${this.baseUrl}/resume/analyze`, { fileId, forceRefresh }).pipe(
      tap(() => this.invalidateDeveloperSignalState())
    );
  }

  getResumeAnalysis(fileId?: string): Observable<any> {
    const suffix = fileId ? `?fileId=${encodeURIComponent(fileId)}` : '';
    return this.http.get(`${this.baseUrl}/resume/result${suffix}`);
  }

  getResumeFiles(): Observable<any> {
    return this.http.get(`${this.baseUrl}/resume/files`);
  }

  getActiveResumeContext(): Observable<any> {
    return this.http.get(`${this.baseUrl}/resume/active`);
  }

  setActiveResume(fileId: string, setAsDefault = false): Observable<any> {
    return this.http.put(`${this.baseUrl}/resume/active`, { fileId, setAsDefault }).pipe(
      tap(() => this.invalidateDeveloperSignalState())
    );
  }

  downloadResumeGuide(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/resume/guide`, { responseType: 'blob' });
  }

  /* ── AI Analysis (career-profile-aware) ── */
  getSkillGap(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    resumeText?:     string,
    isTemporary = false
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/skillgap/skill-gap`, {
      username, careerStack, experienceLevel, resumeText, isTemporary
    }).pipe(
      tap(() => this.invalidateScenarioContextCache())
    );
  }

  getRecommendations(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    knownSkills?:    string[],
    missingSkills?:  string[],
    isTemporary = false
  ): Observable<any> {
    const endpoint = isTemporary ? `${this.baseUrl}/recommendations/generate` : `${this.baseUrl}/recommendations`;
    return this.http.post(endpoint, isTemporary ? {
      githubUsername: username,
      careerStack,
      experienceLevel,
      knownSkills,
      missingSkills,
      isTemporary: true
    } : {
      username,
      careerStack,
      experienceLevel,
      knownSkills,
      missingSkills
    }).pipe(
      tap(() => this.invalidateScenarioContextCache())
    );
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
  getDashboardSummary(refresh = false): Observable<any> {
    return this.http.get(this.withQuery(`${this.baseUrl}/dashboard/summary`, {
      refresh: refresh ? 'true' : undefined
    }));
  }

  getDashboardContributions(refresh = false): Observable<any> {
    return this.http.get(this.withQuery(`${this.baseUrl}/dashboard/contributions`, {
      refresh: refresh ? 'true' : undefined
    }));
  }

  getDashboardLanguages(refresh = false): Observable<any> {
    return this.http.get(this.withQuery(`${this.baseUrl}/dashboard/languages`, {
      refresh: refresh ? 'true' : undefined
    }));
  }

  getDashboardSkills(refresh = false): Observable<any> {
    return this.http.get(this.withQuery(`${this.baseUrl}/dashboard/skills`, {
      refresh: refresh ? 'true' : undefined
    }));
  }

  getDashboardRecommendations(refresh = false): Observable<any> {
    return this.http.get(this.withQuery(`${this.baseUrl}/dashboard/recommendations`, {
      refresh: refresh ? 'true' : undefined
    }));
  }

  getDashboardIntegrationAnalytics(days = 7): Observable<any> {
    return this.http.get(this.withQuery(`${this.baseUrl}/dashboard/integration-analytics`, {
      days: String(days)
    }));
  }

  /* ── Audit Logs ── */
  getAuditLogs(params: {
    actor?: string;
    action?: string;
    organizationId?: string;
    teamId?: string;
    role?: string;
    method?: string;
    statusCode?: string | number;
    actionCategory?: string;
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

  createAdminRecruiterDirect(payload: { name: string; email: string; password: string; teamId?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/recruiters/direct`, payload);
  }

  getInvitations(organizationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/organizations/${organizationId}/invitations`);
  }

  getAdminTeams(organizationId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/tenant/organizations/${organizationId}/teams`);
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
    return this.http.post(`${this.baseUrl}/integrations/sync-now`, provider ? { provider } : {}).pipe(
      tap(() => this.invalidateDeveloperSignalState())
    );
  }

  runWhatIfSimulation(payload: {
    baselineHiringScore: number;
    baselineJobMatch: number;
    role?: string;
    experienceLevel?: string;
    durationWeeks?: number;
    skills: string[];
    projects: Array<{ name: string; impact: number; complexity: 'low' | 'medium' | 'high'; weeks: number }>;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/simulator/what-if`, payload);
  }

  getScenarioSimulatorContext(forceRefresh = false): Observable<any> {
    if (!forceRefresh && this.scenarioContextCache) {
      return of(this.scenarioContextCache);
    }
    const url = `${this.baseUrl}/simulator/context${forceRefresh ? '?forceRefresh=true' : ''}`;
    return this.http.get(url).pipe(tap((response) => {
      this.scenarioContextCache = response;
    }));
  }

  saveScenarioSimulation(payload: {
    name?: string;
    baselineHiringScore: number;
    baselineJobMatch: number;
    role?: string;
    experienceLevel?: string;
    durationWeeks?: number;
    skills: string[];
    projects: Array<{ name: string; impact: number; complexity: 'low' | 'medium' | 'high'; weeks: number }>;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/simulator/save`, payload).pipe(tap(() => {
      this.invalidateScenarioHistoryCache();
    }));
  }

  getScenarioSimulationHistory(limit = 8, forceRefresh = false): Observable<any> {
    if (!forceRefresh && this.scenarioHistoryCache.has(limit)) {
      return of(this.scenarioHistoryCache.get(limit));
    }
    const params = `limit=${encodeURIComponent(String(limit))}${forceRefresh ? '&forceRefresh=true' : ''}`;
    return this.http.get(`${this.baseUrl}/simulator/history?${params}`).pipe(tap((response) => {
      this.scenarioHistoryCache.set(limit, response);
    }));
  }

  deleteScenarioSimulation(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/simulator/${encodeURIComponent(id)}`).pipe(tap(() => {
      this.invalidateScenarioHistoryCache();
    }));
  }

  invalidateScenarioHistoryCache(): void {
    this.scenarioHistoryCache.clear();
  }

  invalidateScenarioContextCache(): void {
    this.scenarioContextCache = null;
  }

  private invalidateDeveloperSignalState(): void {
    this.frontendCache.clearCurrentSignalHash();
    this.invalidateScenarioContextCache();
  }

  createSprintFromScenario(payload: {
    baselineHiringScore: number;
    baselineJobMatch: number;
    role?: string;
    experienceLevel?: string;
    durationWeeks?: number;
    skills: string[];
    projects: Array<{ name: string; impact: number; complexity: 'low' | 'medium' | 'high'; weeks: number }>;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/simulator/create-sprint`, payload).pipe(
      tap(() => this.invalidateDeveloperSignalState())
    );
  }

  /* ── Public Profiles ── */
  getPublicProfile(slug: string): Observable<any> {
    const cacheBust = Date.now();
    return this.http.get(`${this.baseUrl}/public-profiles/${encodeURIComponent(slug)}?_=${cacheBust}`);
  }

  getMyPublicProfile(): Observable<any> {
    const cacheBust = Date.now();
    return this.http.get(`${this.baseUrl}/public-profiles/me?_=${cacheBust}`, {
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    });
  }

  updateMyPublicProfile(payload: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/public-profiles/me`, payload);
  }

  getPublicProfileAnalytics(): Observable<any> {
    const cacheBust = Date.now();
    return this.http.get(`${this.baseUrl}/public-profiles/me/analytics?_=${cacheBust}`, {
      headers: {
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache'
      }
    });
  }

  /* ── Recruiter Dashboard ── */
  getRecruiterDashboard(): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter/dashboard`);
  }

  getRecruiterCandidates(params: {
    search?: string;
    stack?: string;
    experience?: number;
    minScore?: number;
    skills?: string[];
    limit?: number;
  } = {}): Observable<any> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.stack) query.set('stack', params.stack);
    if (params.experience !== undefined) query.set('experience', String(params.experience));
    if (params.minScore !== undefined) query.set('minScore', String(params.minScore));
    if (params.skills?.length) query.set('skills', params.skills.join(','));
    if (params.limit) query.set('limit', String(params.limit));
    const suffix = query.toString();
    const path = suffix
      ? `${this.baseUrl}/recruiter/candidates?${suffix}`
      : `${this.baseUrl}/recruiter/candidates`;
    return this.http.get(path);
  }

  getRecruiterCandidateById(candidateId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter/candidate/${encodeURIComponent(candidateId)}`);
  }

  getRecruiterJobs(): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter/jobs`);
  }

  createRecruiterJob(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter/job`, payload);
  }

  updateRecruiterJob(jobId: string, payload: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/recruiter/job/${encodeURIComponent(jobId)}`, payload);
  }

  deleteRecruiterJob(jobId: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/recruiter/job/${encodeURIComponent(jobId)}`);
  }

  matchRecruiterCandidates(payload: { jobId: string; candidateIds?: string[] }): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter/match`, payload);
  }

  aiRankCandidates(payload: { jobId?: string; candidateIds?: string[]; candidates?: any[]; job?: any }): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter/ai-rank`, payload);
  }

  /* ── Recruiter Hub ── */
  getRecruiterHubDashboard(): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter-hub/analytics/dashboard`);
  }

  getRecruiterHubAnalytics(): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter-hub/analytics`);
  }

  getRecruiterHubActivity(params: Record<string, string | number> = {}): Observable<any> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString();
    return this.http.get(suffix ? `${this.baseUrl}/recruiter-hub/activity?${suffix}` : `${this.baseUrl}/recruiter-hub/activity`);
  }

  getRecruiterHubCandidates(params: Record<string, string | number> = {}): Observable<any> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString();
    return this.http.get(suffix ? `${this.baseUrl}/recruiter-hub/candidates?${suffix}` : `${this.baseUrl}/recruiter-hub/candidates`);
  }

  getRecruiterHubCandidate(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter-hub/candidates/${encodeURIComponent(id)}`);
  }

  analyzeRecruiterHubCandidate(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter-hub/candidates/${encodeURIComponent(id)}/analyze`, {});
  }

  getRecruiterHubJobs(): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter-hub/jobs`);
  }

  getRecruiterHubJob(id: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter-hub/jobs/${encodeURIComponent(id)}`);
  }

  createRecruiterHubJob(payload: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter-hub/jobs`, payload);
  }

  updateRecruiterHubJob(id: string, payload: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${this.baseUrl}/recruiter-hub/jobs/${encodeURIComponent(id)}`, payload);
  }

  archiveRecruiterHubJob(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter-hub/jobs/${encodeURIComponent(id)}/archive`, {});
  }

  deleteRecruiterHubJob(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/recruiter-hub/jobs/${encodeURIComponent(id)}`);
  }

  getRecruiterHubMatches(params: Record<string, string | number> = {}): Observable<any> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString();
    return this.http.get(suffix ? `${this.baseUrl}/recruiter-hub/matches?${suffix}` : `${this.baseUrl}/recruiter-hub/matches`);
  }

  generateRecruiterHubMatches(payload: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter-hub/matches/generate`, payload);
  }

  updateRecruiterHubMatchStatus(id: string, payload: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${this.baseUrl}/recruiter-hub/matches/${encodeURIComponent(id)}/status`, payload);
  }

  getRecruiterHubShortlists(params: Record<string, string | number> = {}): Observable<any> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString();
    return this.http.get(suffix ? `${this.baseUrl}/recruiter-hub/shortlists?${suffix}` : `${this.baseUrl}/recruiter-hub/shortlists`);
  }

  createRecruiterHubShortlist(payload: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter-hub/shortlists`, payload);
  }

  updateRecruiterHubShortlist(id: string, payload: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${this.baseUrl}/recruiter-hub/shortlists/${encodeURIComponent(id)}`, payload);
  }

  deleteRecruiterHubShortlist(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/recruiter-hub/shortlists/${encodeURIComponent(id)}`);
  }

  compareRecruiterHubCandidates(payload: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.baseUrl}/recruiter-hub/comparison`, payload);
  }

  getRecruiterHubProfile(): Observable<any> {
    return this.http.get(`${this.baseUrl}/recruiter-hub/profile`);
  }

  updateRecruiterHubProfile(payload: Record<string, unknown>): Observable<any> {
    return this.http.patch(`${this.baseUrl}/recruiter-hub/profile`, payload);
  }

  /* ── Admin Hiring APIs ── */
  getAdminOverview(): Observable<any> {
    return this.http.get(`${this.baseUrl}/admin/overview`);
  }

  getAdminRecruiters(): Observable<any> {
    return this.http.get(`${this.baseUrl}/admin/recruiters`);
  }

  inviteAdminRecruiter(payload: {
    name: string;
    email: string;
    role?: 'recruiter';
    teamId?: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/invite-recruiter`, payload);
  }

  updateAdminRecruiter(id: string, payload: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/admin/recruiters/${encodeURIComponent(id)}`, payload);
  }

  setAdminRecruiterActive(id: string, isActive: boolean): Observable<any> {
    return this.http.patch(`${this.baseUrl}/admin/recruiters/${encodeURIComponent(id)}/active`, { isActive });
  }

  revokeAdminRecruiterAccess(id: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/admin/recruiters/${encodeURIComponent(id)}/revoke`, {});
  }

  deleteAdminRecruiter(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/admin/recruiters/${encodeURIComponent(id)}`);
  }

  getAdminPendingInvitations(): Observable<any> {
    return this.http.get(`${this.baseUrl}/admin/invitations/pending`);
  }

  resendAdminInvitation(id: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/invitations/${encodeURIComponent(id)}/resend`, {});
  }

  revokeAdminInvitation(id: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/admin/invitations/${encodeURIComponent(id)}/revoke`, {});
  }

  expireAdminInvitation(id: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/admin/invitations/${encodeURIComponent(id)}/expire`, {});
  }

  deleteAdminInvitation(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/admin/invitations/${encodeURIComponent(id)}`);
  }

  getAdminDevelopers(params: Record<string, string | number> = {}): Observable<any> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString();
    return this.http.get(suffix ? `${this.baseUrl}/admin/developers?${suffix}` : `${this.baseUrl}/admin/developers`);
  }

  getAdminJobs(params: Record<string, string | number> = {}): Observable<any> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
    });
    const suffix = query.toString();
    return this.http.get(suffix ? `${this.baseUrl}/admin/jobs?${suffix}` : `${this.baseUrl}/admin/jobs`);
  }

  createAdminJob(payload: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/jobs`, payload);
  }

  updateAdminJob(id: string, payload: any): Observable<any> {
    return this.http.put(`${this.baseUrl}/admin/jobs/${encodeURIComponent(id)}`, payload);
  }

  closeAdminJob(id: string): Observable<any> {
    return this.http.patch(`${this.baseUrl}/admin/jobs/${encodeURIComponent(id)}/close`, {});
  }

  deleteAdminJob(id: string): Observable<any> {
    return this.http.delete(`${this.baseUrl}/admin/jobs/${encodeURIComponent(id)}`);
  }

  runAdminAiRanking(payload: { jobId: string; candidateIds?: string[]; candidates?: any[] }): Observable<any> {
    return this.http.post(`${this.baseUrl}/admin/ai-rank`, payload);
  }

  /* ── Weekly AI Reports ── */
  generateWeeklyReport(forceRefresh = false): Observable<any> {
    return this.http.post(`${this.baseUrl}/weekly-reports/generate?forceRefresh=${forceRefresh ? 'true' : 'false'}`, {});
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

  getInterviewPrepQuestions(params: { skill: string; page?: number; limit?: number; difficulty?: string; tags?: string[]; block?: string; category?: string; source?: string }): Observable<any> {
    const query = new URLSearchParams();
    query.set('skill', params.skill);
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 20));
    if (params.difficulty) query.set('difficulty', params.difficulty);
    if (params.tags?.length) query.set('tags', params.tags.join(','));
    if (params.block) query.set('block', params.block);
    if (params.category) query.set('category', params.category);
    if (params.source) query.set('source', params.source);
    return this.http.get(`${this.baseUrl}/interview-prep/questions?${query.toString()}`);
  }

  searchInterviewPrepQuestions(params: { q: string; page?: number; limit?: number; skill?: string; difficulty?: string; tags?: string[]; lookupOnly?: boolean }): Observable<any> {
    const query = new URLSearchParams();
    query.set('q', params.q);
    query.set('page', String(params.page ?? 1));
    query.set('limit', String(params.limit ?? 20));
    if (params.skill) query.set('skill', params.skill);
    if (params.difficulty) query.set('difficulty', params.difficulty);
    if (params.tags?.length) query.set('tags', params.tags.join(','));
    if (params.lookupOnly) query.set('lookupOnly', 'true');
    return this.http.get(`${this.baseUrl}/interview-prep/search?${query.toString()}`);
  }

  generateInterviewPrepQuestions(payload: { skill: string; query?: string; difficulty?: string; page?: number; limit?: number; target?: number }): Observable<any> {
    return this.http.post(`${this.baseUrl}/interview-prep/generate`, payload);
  }

  askInterviewPrepQuestion(payload: {
    question: string;
    skill?: string;
    topic?: string;
    stack?: string;
    technology?: string;
    language?: string;
    framework?: string;
  }): Observable<any> {
    return this.http.post(`${this.baseUrl}/interview-prep/ask-question`, payload);
  }

  getInterviewPrepHistory(limit = 5): Observable<any> {
    return this.http.get(`${this.baseUrl}/interview-prep/history?limit=${encodeURIComponent(String(limit))}`);
  }

  /* ── Career Sprint ── */
  getCurrentCareerSprint(): Observable<any> {
    return this.http.get(`${this.baseUrl}/career-sprints/current`);
  }

  createCareerSprint(payload: { title?: string; weeklyGoal?: number; tasks?: Array<{ title: string; description?: string; points?: number }> }): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints`, payload).pipe(tap(() => {
      this.invalidateScenarioContextCache();
    }));
  }

  addCareerSprintTask(sprintId: string, payload: { title: string; description?: string; points?: number }): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints/${sprintId}/tasks`, payload).pipe(tap(() => {
      this.invalidateScenarioContextCache();
    }));
  }

  updateCareerSprintTask(sprintId: string, taskId: string, isCompleted: boolean): Observable<any> {
    return this.http.put(`${this.baseUrl}/career-sprints/${sprintId}/tasks/${taskId}`, { isCompleted }).pipe(tap(() => {
      this.invalidateScenarioContextCache();
    }));
  }

  getCareerSprintHistory(limit = 6): Observable<any> {
    return this.http.get(`${this.baseUrl}/career-sprints/history?limit=${encodeURIComponent(String(limit))}`);
  }

  restoreCareerStreak(sprintId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints/${sprintId}/restore-streak`, {});
  }

  generateAiTasks(payload: { stack?: string; technology?: string; experienceLevel?: string; sprintStartDate?: string; sprintEndDate?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints/generate-plan`, payload);
  }

  generateCareerSprintAiPlan(payload: { stack?: string; technology?: string; experienceLevel?: string; sprintStartDate?: string; sprintEndDate?: string }): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints/generate-ai-plan`, payload);
  }

  saveCareerSprintAiPlan(sprintId: string, payload: Record<string, unknown>): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints/${sprintId}/ai-plans`, payload).pipe(tap(() => {
      this.invalidateScenarioContextCache();
    }));
  }

  importCareerSprintScenarioPlan(sprintId: string, scenarioId?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/career-sprints/${sprintId}/import-scenario`, scenarioId ? { scenarioId } : {}).pipe(tap(() => {
      this.invalidateScenarioContextCache();
    }));
  }

  updateSprintDates(sprintId: string, sprintStartDate: string, sprintEndDate: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/career-sprints/${sprintId}/dates`, { sprintStartDate, sprintEndDate }).pipe(tap(() => {
      this.invalidateScenarioContextCache();
    }));
  }

  private withQuery(url: string, params: Record<string, string | undefined>): string {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, value);
      }
    });

    const suffix = query.toString();
    return suffix ? `${url}?${suffix}` : url;
  }
}
