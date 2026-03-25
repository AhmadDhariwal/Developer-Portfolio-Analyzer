import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';

export interface CandidateSkillScore {
  name: string;
  score: number;
}

export interface RecruiterCandidate {
  id: string;
  name: string;
  jobTitle: string;
  location: string;
  githubUsername: string;
  avatar: string;
  score: number;
  githubScore: number;
  resumeScore: number;
  skillScores: CandidateSkillScore[];
  publicProfileSlug: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class RecruiterDashboardService {
  constructor(private readonly api: ApiService) {}

  fetchCandidates(params: { search?: string; minScore?: number; skills?: string[]; limit?: number } = {}): Observable<{ candidates: RecruiterCandidate[] }> {
    return this.api.getRecruiterCandidates(params);
  }
}
