import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = 'http://localhost:5000/api';

  constructor(private readonly http: HttpClient) {}

  /* ── Auth ── */
  register(userData: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/register`, userData);
  }

  login(credentials: any): Observable<any> {
    return this.http.post(`${this.baseUrl}/auth/login`, credentials);
  }

  /* ── Career Profile ── */
  updateCareerProfile(careerStack: string, experienceLevel: string, careerGoal?: string): Observable<any> {
    return this.http.put(`${this.baseUrl}/profile/career`, { careerStack, experienceLevel, careerGoal });
  }

  /* ── GitHub / Resume / Analysis ── */
  analyzeGitHub(username: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/github/analyze`, { username });
  }

  uploadResume(formData: FormData): Observable<any> {
    return this.http.post(`${this.baseUrl}/resume/upload`, formData);
  }

  analyzeResume(fileId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/resume/analyze`, { fileId });
  }

  getResumeAnalysis(): Observable<any> {
    return this.http.get(`${this.baseUrl}/resume/result`);
  }

  downloadResumeGuide(): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/resume/guide`, { responseType: 'blob' });
  }

  /* ── AI Analysis (career-profile-aware) ── */
  getSkillGap(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    resumeText?:     string
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/skillgap/skill-gap`, {
      username, careerStack, experienceLevel, resumeText
    });
  }

  getRecommendations(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    knownSkills?:    string[],
    missingSkills?:  string[]
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/recommendations`, {
      username, careerStack, experienceLevel, knownSkills, missingSkills
    });
  }

  getPortfolioScore(
    username:        string,
    careerStack:     string,
    experienceLevel: string,
    resumeAnalysis:  any,
    githubAnalysis:  any,
    resumeText?:     string
  ): Observable<any> {
    return this.http.post(`${this.baseUrl}/analysis/portfolio-score`, {
      username, careerStack, experienceLevel, resumeAnalysis, githubAnalysis, resumeText
    });
  }

  /* ── Dashboard ── */
  getDashboardSummary(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/summary`);
  }

  getDashboardContributions(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/contributions`);
  }

  getDashboardLanguages(): Observable<any> {
    return this.http.get(`${this.baseUrl}/dashboard/languages`);
  }
}
