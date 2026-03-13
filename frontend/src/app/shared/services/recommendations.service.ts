import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RecommendedProject {
  id: string;
  title: string;
  description: string;
  tech: string[];
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  estimatedWeeks: string;
  impact: number;
  triggerSkills: string[];
}

export interface RecommendedTechnology {
  name: string;
  category: string;
  priority: string;       // "Must Learn" | "High Priority" | "Recommended"
  priorityRaw: 'High' | 'Medium' | 'Low';
  jobDemand: number;      // 0-100
  description: string;
}

export interface CareerPath {
  id: string;
  title: string;
  salaryRange: string;
  timeline: string;
  description: string;
  hiringCompanies: string[];
  actionItems: string[];
  boostSkills: string[];
  match: number;          // 0-100
}

export interface RecommendationsResult {
  username: string;
  projects: RecommendedProject[];
  technologies: RecommendedTechnology[];
  careerPaths: CareerPath[];
}

@Injectable({ providedIn: 'root' })
export class RecommendationsService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  getRecommendations(username: string, targetRole: string): Observable<RecommendationsResult> {
    return this.http.post<RecommendationsResult>(
      `${this.baseUrl}/recommendations`,
      { username, targetRole }
    );
  }
}
