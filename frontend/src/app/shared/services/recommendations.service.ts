import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RecommendedProject {
  id:             string;
  title:          string;
  description:    string;
  tech:           string[];
  newTech:        string[];   // subset of tech[] that are new to the user
  difficulty:     'Beginner' | 'Intermediate' | 'Advanced';
  estimatedWeeks: string;
  impact:         number;
  whyThisProject: string;     // explanation of level fit
  triggerSkills:  string[];
  startUrl?:      string;
}

export interface RecommendedTechnology {
  name:        string;
  category:    string;
  priority:    string;
  priorityRaw: 'High' | 'Medium' | 'Low';
  jobDemand:   number;
  description: string;
}

export interface CareerPath {
  id:              string;
  title:           string;
  salaryRange:     string;
  timeline:        string;
  description:     string;
  hiringCompanies: string[];
  actionItems:     string[];
  boostSkills:     string[];
  match:           number;
  exploreUrl?:     string;
}

export interface RecommendationsResult {
  username:        string;
  careerStack:     string;
  experienceLevel: string;
  projects:        RecommendedProject[];
  technologies:    RecommendedTechnology[];
  careerPaths:     CareerPath[];
}

@Injectable({ providedIn: 'root' })
export class RecommendationsService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  getRecommendations(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    knownSkills?:    string[],
    missingSkills?:  string[]
  ): Observable<RecommendationsResult> {
    return this.http.post<RecommendationsResult>(
      `${this.baseUrl}/recommendations`,
      { username, careerStack, experienceLevel, knownSkills, missingSkills }
    );
  }
}
