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
  resumeSkills?:   string[];
  githubSkills?:   string[];
  provenSkills?:   string[];
  claimedButNotProvenSkills?: string[];
  levelAssessment: string;
  analysisSummary?: string;
  roadmap:         RoadmapPhase[];
  skillGraph?: {
    nodes: SkillGraphNode[];
    edges: SkillGraphEdge[];
  };
  weeklyRoadmap?: WeeklyRoadmapWeek[];
  signalsUsed?: {
    github: {
      connected: boolean;
      username: string;
      repoCount: number;
      developerLevel: string;
    };
    resume: {
      analyzed: boolean;
      analysisId?: string;
      atsScore: number;
      experienceLevel: string;
      fileName?: string;
      lastAnalyzedAt?: string | null;
      extractedSkills?: string[];
      experienceKeywords?: string[];
      strengths?: string[];
      weaknesses?: string[];
      missingSections?: string[];
      statusMessage?: string;
    };
    portfolio: {
      present: boolean;
      completenessScore: number;
      projectCount: number;
      liveLinkCount: number;
    };
    integrations: {
      providers: string[];
      score: number;
      strongestProof: string[];
    };
    weeklyProgress: {
      status: string;
      score: number;
      trendDelta: number;
    };
    careerSprint: {
      consistencyScore: number;
      streak: number;
      activeLearningFocus: string;
    };
  };
  analysisBasedOn?: {
    githubUsername: string;
    resumeAnalyzed: boolean;
    resumeStatus: string;
    careerStack: string;
    experienceLevel: string;
    lastAnalyzedAt?: string | null;
  };
  resumeStatusMessage?: string;
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
    experienceLevel: string,
    isTemporary = false
  ): Observable<SkillGapResult> {
    return this.http.post<SkillGapResult>(
      `${this.baseUrl}/skillgap/skill-gap`,
      { username, careerStack, experienceLevel, isTemporary }
    );
  }
}
