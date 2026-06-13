import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

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
    jobsCount: number;
    pendingInvitationsCount: number;
    membersCount: number;
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
  memberCount: number;
  createdAt: string;
  members: Array<{
    _id: string;
    name: string;
    email: string;
    role: string;
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
  };
}

@Injectable({ providedIn: 'root' })
export class AdminConsoleService {
  private readonly base = `${environment.apiBaseUrl}/admin-console`;

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

  getPreferences(): Observable<ConsolePreferences> {
    return this.http.get<ConsolePreferences>(`${this.base}/preferences`);
  }

  updatePreferences(payload: { name: string; description: string }): Observable<ConsolePreferences & { message: string }> {
    return this.http.patch<any>(`${this.base}/preferences`, payload);
  }
}
