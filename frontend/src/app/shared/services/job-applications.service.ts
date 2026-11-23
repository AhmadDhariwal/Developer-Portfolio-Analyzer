import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export interface InternalJob {
  organizationName?: string;
  _id: string;
  title: string;
  description: string;
  location: string;
  employmentType: string;
  requiredSkills: string[];
  minExperienceYears: number;
}
export interface PortfolioSubmission {
  headline: string;
  summary: string;
  skills: string[];
  projects: { title: string; description: string; tech: string[] }[];
}
export interface DirectApplication {
  shortlist?: { id: string; status: string; version: number } | null;
  organizationName?: string;
  _id: string;
  jobId: string;
  jobTitle: string;
  applicantName?: string;
  status: 'submitted' | 'reviewing' | 'rejected' | 'withdrawn';
  timeline?: { status: string; at: string }[];
  resume: { fileName: string; sha256: string };
  portfolio: PortfolioSubmission | null;
  createdAt: string;
}
export interface ApplicationOptions {
  portfolioHash: string;
  resumes: { _id: string; fileName: string; uploadDate: string }[];
  portfolio: PortfolioSubmission | null;
}
@Injectable({ providedIn: 'root' })
export class JobApplicationsService {
  private readonly base = environment.apiBaseUrl;
  constructor(private readonly http: HttpClient) {}
  discover() {
    return this.http.get<{ jobs: InternalJob[] }>(`${this.base}/jobs/internal`);
  }
  options() {
    return this.http.get<ApplicationOptions>(`${this.base}/jobs/internal/options`);
  }
  mine() {
    return this.http.get<{ applications: DirectApplication[] }>(
      `${this.base}/jobs/internal/applications`,
    );
  }
  submit(jobId: string, resumeId: string, sharePortfolio: boolean, portfolioHash: string) {
    return this.http.post<{ application: DirectApplication }>(
      `${this.base}/jobs/internal/${encodeURIComponent(jobId)}/applications`,
      { resumeId, sharePortfolio, portfolioHash, consent: true },
    );
  }
  applicants(jobId: string) {
    return this.http.get<{ applications: DirectApplication[] }>(this.url(jobId));
  }
  application(jobId: string, id: string) {
    return this.http.get<{ application: DirectApplication }>(
      this.url(jobId) + '/' + encodeURIComponent(id),
    );
  }
  shortlist(jobId: string, id: string, expectedStatus: string) {
    return this.http.post<{ created: boolean }>(
      this.url(jobId) + '/' + encodeURIComponent(id) + '/shortlist',
      { expectedStatus },
    );
  }
  withdraw(id: string, expectedStatus: string) {
    return this.http.post<{ application: DirectApplication }>(
      `${this.base}/jobs/internal/applications/${encodeURIComponent(id)}/withdraw`,
      { expectedStatus },
    );
  }
  status(jobId: string, id: string, status: string, expectedStatus?: string) {
    return this.http.patch(this.url(jobId) + '/' + encodeURIComponent(id), {
      status,
      expectedStatus,
    });
  }
  resume(jobId: string, id: string) {
    return this.http.get(this.url(jobId) + '/' + encodeURIComponent(id) + '/resume', {
      responseType: 'blob',
    });
  }
  private url(jobId: string) {
    return `${this.base}/recruiter-hub/jobs/${encodeURIComponent(jobId)}/applications`;
  }
}
