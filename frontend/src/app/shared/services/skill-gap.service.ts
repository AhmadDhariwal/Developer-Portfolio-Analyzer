import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CurrentSkill {
  name: string;
  category: string;
  proficiency: number;   // 0–100
}

export interface MissingSkill {
  name: string;
  category: string;
  priority: 'High' | 'Medium' | 'Low';
  jobDemand: number;     // percentage
}

export interface RoadmapPhase {
  phase: string;         // "Phase 1"
  duration: string;      // "2-4 weeks"
  title: string;
  description: string;
  skills: string[];
  resources: string[];
  color: 'purple' | 'blue' | 'green' | 'orange';
  topSkill: string;
}

export interface SkillGapResult {
  username: string;
  coverage: number;       // percent covered
  missing: number;        // percent missing
  yourSkills: CurrentSkill[];
  missingSkills: MissingSkill[];
  roadmap: RoadmapPhase[];
  totalWeeks: string;
}

@Injectable({ providedIn: 'root' })
export class SkillGapService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  analyze(username: string): Observable<SkillGapResult> {
    return this.http.post<SkillGapResult>(
      `${this.baseUrl}/analysis/skill-gap`,
      { username }
    );
  }
}
