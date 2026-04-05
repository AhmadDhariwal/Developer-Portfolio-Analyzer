import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import { ProfileService } from './profile.service';

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
  constructor(private readonly api: ApiService, private readonly profileService: ProfileService) {}

  fetchCandidates(params: { search?: string; minScore?: number; skills?: string[]; limit?: number } = {}): Observable<{ candidates: RecruiterCandidate[] }> {
    return this.api.getRecruiterCandidates(params).pipe(
      map((res: { candidates: RecruiterCandidate[] }) => ({
        ...res,
        candidates: (res?.candidates || []).map((candidate) => ({
          ...candidate,
          avatar: this.profileService.resolveAvatarUrl(String(candidate.avatar || ''))
        }))
      }))
    );
  }
}
