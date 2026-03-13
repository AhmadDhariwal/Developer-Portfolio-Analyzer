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

  // New AI Role-Based Methods
  getSkillGap(username: string, targetRole: string, resumeText?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/skillgap/skill-gap`, { username, targetRole, resumeText });
  }

  getRecommendations(username: string, targetRole: string, missingSkills: string[], resumeText?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/recommendations`, { username, targetRole, missingSkills, resumeText });
  }

  getPortfolioScore(username: string, targetRole: string, resumeAnalysis: any, githubAnalysis: any, resumeText?: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/analysis/portfolio-score`, { 
      username, targetRole, resumeAnalysis, githubAnalysis, resumeText 
    });
  }

  /* ── Dashboard (Simplified for AI integration) ── */
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
