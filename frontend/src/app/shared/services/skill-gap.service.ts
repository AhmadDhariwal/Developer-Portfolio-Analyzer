import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CurrentSkill {
  name:           string;
  category:       string;
  proficiency:    number;   // 0–100
  isFoundational: boolean;  // true if core to the career stack
}

export interface MissingSkill {
  name:           string;
  category:       string;
  priority:       'High' | 'Medium' | 'Low';
  jobDemand:      number;   // percentage
  levelRelevance: 'Current' | 'Next Level' | 'Advanced';
}

export interface RoadmapPhase {
  phase:       string;
  duration:    string;
  title:       string;
  description: string;
  skills:      string[];
  resources:   Array<{ title: string; url: string } | string>;
  color:       'purple' | 'blue' | 'green' | 'orange';
  topSkill:    string;
}

export interface SkillGapResult {
  username:        string;
  careerStack:     string;
  experienceLevel: string;
  coverage:        number;
  missing:         number;
  yourSkills:      CurrentSkill[];
  missingSkills:   MissingSkill[];
  levelAssessment: string;
  roadmap:         RoadmapPhase[];
  skillGraph?: {
    nodes: SkillGraphNode[];
    edges: SkillGraphEdge[];
  };
  weeklyRoadmap?: WeeklyRoadmapWeek[];
  totalWeeks:      string;
}

export interface SkillGraphNode {
  id: string;
  name: string;
  category: string;
  demandScore: number;
  proficiency: number;
  kind: 'current' | 'missing';
  relatedSkills: string[];
}

export interface SkillGraphEdge {
  from: string;
  to: string;
  type: 'prerequisite' | 'dependency' | 'related';
  weight: number;
}

export interface WeeklyRoadmapWeek {
  week: number;
  focusSkills: string[];
  reason: string;
  outcomes: string[];
}

@Injectable({ providedIn: 'root' })
export class SkillGapService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  analyze(
    username:        string,
    careerStack:     string,
    experienceLevel: string
  ): Observable<SkillGapResult> {
    return this.http.post<SkillGapResult>(
      `${this.baseUrl}/skillgap/skill-gap`,
      { username, careerStack, experienceLevel }
    );
  }
}
