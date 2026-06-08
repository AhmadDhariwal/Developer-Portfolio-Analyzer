import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ConsoleOverview {
  organization: {
    _id: string;
    name: string;
    slug: string;
    description: string;
    createdAt: string;
  };
  stats: {
    recruitersCount: number;
    activeRecruitersCount: number;
    inactiveRecruitersCount: number;
    teamsCount: number;
    activeTeamsCount: number;
    jobsCount: number;
    pendingInvitationsCount: number;
    membersCount: number;
  };
  membershipSummary?: {
    internalMembersCount: number;
    adminCount: number;
    recruiterCount: number;
    memberCount: number;
    publicDevelopersIncluded: boolean;
  };
}

export interface RecruiterPerformance {
  _id: string;
  name: string;
  email: string;
  isActive: boolean;
  jobsPosted: number;
  joinedAt: string;
}

export interface TeamSummary {
  _id: string;
  name: string;
  memberCount: number;
  createdAt: string;
}

export interface ConsoleAnalytics {
  recruiterPerformance: RecruiterPerformance[];
  teamSummary: TeamSummary[];
  hiringActivity: { total: number; open: number; draft: number; closed: number };
  invitationFunnel: { pending: number; accepted: number; expired: number; revoked: number };
  recentInvitations: Array<{
    _id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    createdAt: string;
    expiresAt: string;
  }>;
}

export interface ConsoleTeam {
  _id: string;
  name: string;
  slug: string;
  description: string;
  isActive: boolean;
  memberCount: number;
  createdAt: string;
  members: Array<{
    _id: string;
    name: string;
    email: string;
    role: string;
    githubUsername?: string;
    isActive: boolean;
  }>;
}

export interface ActivityLog {
  _id: string;
  actor: { _id: string; name: string; email: string; role: string } | null;
  action: string;
  method: string;
  route: string;
  statusCode: number;
  timestamp: string;
}

export interface ConsolePreferences {
  organization: {
    _id: string;
    name: string;
    slug: string;
    description: string;
    createdAt: string;
    ownerId: string;
    dashboardConfig?: {
      preferredDateRangeDays: number;
      defaultTeamId: string;
      showKpiCards: boolean;
      showTeamAnalytics: boolean;
      showRecruiterPerformance: boolean;
      showJobTrends: boolean;
      showActivityFeed: boolean;
    };
  };
}

@Injectable({ providedIn: 'root' })
export class AdminConsoleService {
  private readonly base = 'http://localhost:5000/api/admin-console';

  constructor(private readonly http: HttpClient) {}

  getOverview(): Observable<ConsoleOverview> {
    return this.http.get<ConsoleOverview>(`${this.base}/overview`);
  }

  getAnalytics(): Observable<ConsoleAnalytics> {
    return this.http.get<ConsoleAnalytics>(`${this.base}/analytics`);
  }

  getActivity(page = 1, limit = 25): Observable<{ logs: ActivityLog[]; total: number; page: number; totalPages: number }> {
    return this.http.get<any>(`${this.base}/activity?page=${page}&limit=${limit}`);
  }

  getTeams(): Observable<{ teams: ConsoleTeam[] }> {
    return this.http.get<{ teams: ConsoleTeam[] }>(`${this.base}/teams`);
  }

  getTeamsPaginated(params: Record<string, string | number> = {}): Observable<{
    teams: any[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasMore: boolean;
  }> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.http.get<any>(suffix ? `${this.base}/teams?${suffix}` : `${this.base}/teams`);
  }

  getPerformance(params: Record<string, string | number> = {}): Observable<any> {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });
    const suffix = query.toString();
    return this.http.get<any>(suffix ? `${this.base}/performance?${suffix}` : `${this.base}/performance`);
  }

  createTeam(payload: { name: string; slug?: string; description?: string; recruiterId?: string }): Observable<{ team: ConsoleTeam }> {
    return this.http.post<{ team: ConsoleTeam }>(`${this.base}/teams`, payload);
  }

  updateTeam(id: string, payload: { name?: string; slug?: string; description?: string }): Observable<{ team: ConsoleTeam }> {
    return this.http.patch<{ team: ConsoleTeam }>(`${this.base}/teams/${encodeURIComponent(id)}`, payload);
  }

  setTeamActive(id: string, isActive: boolean): Observable<{ team: ConsoleTeam }> {
    return this.http.patch<{ team: ConsoleTeam }>(`${this.base}/teams/${encodeURIComponent(id)}/active`, { isActive });
  }

  deleteTeam(id: string): Observable<{ message: string }> {
    return this.http.delete<{ message: string }>(`${this.base}/teams/${encodeURIComponent(id)}`);
  }

  assignRecruiterToTeam(id: string, recruiterId: string): Observable<{ team: ConsoleTeam }> {
    return this.http.post<{ team: ConsoleTeam }>(`${this.base}/teams/${encodeURIComponent(id)}/recruiters`, { recruiterId });
  }

  removeRecruiterFromTeam(id: string, recruiterId: string): Observable<{ team: ConsoleTeam }> {
    return this.http.delete<{ team: ConsoleTeam }>(`${this.base}/teams/${encodeURIComponent(id)}/recruiters/${encodeURIComponent(recruiterId)}`);
  }

  getPreferences(): Observable<ConsolePreferences> {
    return this.http.get<ConsolePreferences>(`${this.base}/preferences`);
  }

  updatePreferences(payload: {
    name: string;
    description: string;
    dashboardConfig?: {
      preferredDateRangeDays: number;
      defaultTeamId: string;
      showKpiCards: boolean;
      showTeamAnalytics: boolean;
      showRecruiterPerformance: boolean;
      showJobTrends: boolean;
      showActivityFeed: boolean;
    };
  }): Observable<ConsolePreferences & { message: string }> {
    return this.http.patch<any>(`${this.base}/preferences`, payload);
  }
}
