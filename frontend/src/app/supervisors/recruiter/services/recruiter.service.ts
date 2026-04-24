import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { finalize, map, tap } from 'rxjs/operators';

import { ApiService } from '../../../shared/services/api.service';

export interface RecruiterInsight {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}

export interface RecruiterProject {
  title: string;
  description: string;
  impactScore?: number;
  technologies?: string[];
  status?: string;
}

export interface RecruiterCandidate {
  id: string;
  userId?: string;
  fullName: string;
  publicProfileSlug?: string | null;
  stack: string;
  yearsOfExperience: number;
  headline: string;
  location: string;
  githubUsername: string;
  githubScore: number;
  resumeScore: number;
  consistencyScore: number;
  growthPotentialScore: number;
  skills: string[];
  projects: RecruiterProject[];
  githubStats: {
    repos: number;
    stars: number;
    forks: number;
    followers: number;
  };
  score: number;
  aiInsight: RecruiterInsight;
}

export interface RecruiterJob {
  _id: string;
  title: string;
  role: string;
  description: string;
  stack: string;
  requiredSkills: string[];
  preferredSkills: string[];
  minExperienceYears: number;
  location: string;
  employmentType: 'full-time' | 'part-time' | 'contract' | 'internship';
  status: 'draft' | 'open' | 'closed';
  updatedAt?: string;
}

export interface RankedCandidate {
  rank: number;
  rankScore: number;
  candidateId: string;
  candidate: RecruiterCandidate;
  scoreBreakdown: Record<string, { raw: number; weight: number; weighted: number }>;
  aiInsight: RecruiterInsight;
}

export interface MatchResult {
  job: RecruiterJob;
  rankedCandidates: RankedCandidate[];
  meta: {
    totalCandidates: number;
    jobId: string;
    generatedAt: string;
  };
}

@Injectable({
  providedIn: 'root'
})
export class RecruiterService {
  private readonly loadingCounter = new BehaviorSubject<number>(0);
  private readonly latestMatchesSubject = new BehaviorSubject<RankedCandidate[]>([]);

  readonly loading$ = this.loadingCounter.pipe(map((count) => count > 0));
  readonly latestMatches$ = this.latestMatchesSubject.asObservable();

  constructor(private readonly apiService: ApiService) {}

  getCandidates(filters: {
    search?: string;
    stack?: string;
    experience?: number;
    minScore?: number;
    limit?: number;
  } = {}): Observable<RecruiterCandidate[]> {
    return this.withLoading(
      this.apiService.getRecruiterCandidates(filters).pipe(
        map((response: { candidates?: RecruiterCandidate[] }) => response.candidates || [])
      )
    );
  }

  getCandidateById(id: string): Observable<RecruiterCandidate> {
    return this.withLoading(
      this.apiService.getRecruiterCandidateById(id).pipe(
        map((response: { candidate: RecruiterCandidate }) => response.candidate)
      )
    );
  }

  getJobs(): Observable<RecruiterJob[]> {
    return this.withLoading(
      this.apiService.getRecruiterJobs().pipe(
        map((response: { jobs?: RecruiterJob[] }) => response.jobs || [])
      )
    );
  }

  createJob(payload: Partial<RecruiterJob>): Observable<RecruiterJob> {
    return this.withLoading(
      this.apiService.createRecruiterJob(payload).pipe(
        map((response: { job: RecruiterJob }) => response.job)
      )
    );
  }

  updateJob(jobId: string, payload: Partial<RecruiterJob>): Observable<RecruiterJob> {
    return this.withLoading(
      this.apiService.updateRecruiterJob(jobId, payload).pipe(
        map((response: { job: RecruiterJob }) => response.job)
      )
    );
  }

  deleteJob(jobId: string): Observable<{ message: string }> {
    return this.withLoading(this.apiService.deleteRecruiterJob(jobId));
  }

  matchCandidates(jobId: string, candidateIds: string[] = []): Observable<MatchResult> {
    return this.withLoading(
      this.apiService.matchRecruiterCandidates({ jobId, candidateIds }).pipe(
        tap((result: MatchResult) => this.latestMatchesSubject.next(result.rankedCandidates || []))
      )
    );
  }

  rankCandidates(jobId: string, candidateIds: string[] = []): Observable<MatchResult> {
    return this.withLoading(
      this.apiService.aiRankCandidates({ jobId, candidateIds }).pipe(
        tap((result: MatchResult) => this.latestMatchesSubject.next(result.rankedCandidates || []))
      )
    );
  }

  private withLoading<T>(stream$: Observable<T>): Observable<T> {
    this.loadingCounter.next(this.loadingCounter.value + 1);
    return stream$.pipe(
      finalize(() => {
        this.loadingCounter.next(Math.max(0, this.loadingCounter.value - 1));
      })
    );
  }
}
