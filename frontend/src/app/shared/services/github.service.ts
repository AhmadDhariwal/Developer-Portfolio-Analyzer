import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface LanguageDistribution {
  language: string;
  percentage: number;
}

export interface RepositoryActivity {
  repo: string;
  commits: number;
}

export interface Repository {
  name: string;
  language: string;
  stars: number;
  forks: number;
  activityScore: number;
}

export interface GitHubAnalysisResult {
  repoCount: number;
  totalStars: number;
  totalForks: number;
  activityScore: number;
  languageDistribution: LanguageDistribution[];
  repositoryActivity: RepositoryActivity[];
  repositories: Repository[];
}

export interface ActiveUsername {
  username: string;
  isDefault: boolean;
}

@Injectable({ providedIn: 'root' })
export class GithubService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  /** Public — analyze any GitHub username (no auth needed, interceptor adds token if present) */
  analyzeProfile(username: string): Observable<GitHubAnalysisResult> {
    return this.http.post<GitHubAnalysisResult>(
      `${this.baseUrl}/github/analyze`,
      { username }
    );
  }

  /** Private — analyze + persist to the logged-in user's record */
  analyzeAndSave(username: string): Observable<GitHubAnalysisResult> {
    return this.http.post<GitHubAnalysisResult>(
      `${this.baseUrl}/github/analyze-save`,
      { username }
    );
  }

  /** Private — get the active username (last searched or signup default) */
  getActiveUsername(): Observable<ActiveUsername> {
    return this.http.get<ActiveUsername>(
      `${this.baseUrl}/github/active-username`
    );
  }
}
