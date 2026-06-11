import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, map, shareReplay, switchMap, of } from 'rxjs';
import { ProfileService, UserProfile, ResumeContextFile } from './profile.service';
import { ApiService } from './api.service';

export interface ResumeFile {
  fileId: string;
  fileName: string;
  fileSize?: number;
  uploadDate: string;
  isAnalyzed: boolean;
  isDefault: boolean;
  isActive: boolean;
  lastAnalyzed?: string | null;
  resumeHash?: string;
  analysisVersion?: string;
}

const RESUME_ANALYSIS_CACHE_PREFIX = 'resume_analysis_cache:';
const RESUME_ANALYSIS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable({
  providedIn: 'root'
})
export class ResumeService {
  private readonly http = inject(HttpClient);
  private readonly profileService = inject(ProfileService);
  private readonly apiService = inject(ApiService);

  private readonly resumesSubject = new BehaviorSubject<ResumeFile[]>([]);
  resumes$ = this.resumesSubject.asObservable();

  private readonly profileSubject = new BehaviorSubject<UserProfile | null>(null);
  profile$ = this.profileSubject.asObservable();

  private readonly loadingSubject = new BehaviorSubject<boolean>(false);
  loading$ = this.loadingSubject.asObservable();

  constructor() {
    // Initial fetch
    this.refresh();
  }

  refresh(): void {
    this.loadingSubject.next(true);
    
    // Fetch profile and resumes in parallel or sequence
    this.profileService.getProfile().pipe(
      tap(profile => this.profileSubject.next(profile)),
      switchMap(() => this.apiService.getResumeFiles()),
      map(res => Array.isArray(res?.files) ? res.files : []),
      tap(resumes => {
        this.resumesSubject.next(resumes);
        this.loadingSubject.next(false);
      })
    ).subscribe({
      error: () => this.loadingSubject.next(false)
    });
  }

  profileSubjectValue(): UserProfile | null {
    return this.profileSubject.value;
  }

  resumesSubjectValue(): ResumeFile[] {
    return this.resumesSubject.value;
  }

  getCurrentUserId(): string {
    const profileId = String(this.profileSubject.value?._id || '').trim();
    if (profileId) return profileId;
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      return String(user?._id || user?.id || '').trim();
    } catch {
      return '';
    }
  }

  buildAnalysisCacheKey(file: Pick<ResumeFile, 'fileId' | 'resumeHash' | 'analysisVersion'>): string {
    const userId = this.getCurrentUserId() || 'anonymous';
    const fileId = String(file?.fileId || '').trim();
    const hash = String(file?.resumeHash || 'no-hash').trim();
    const version = String(file?.analysisVersion || 'resume-intel-v2').trim();
    return `${RESUME_ANALYSIS_CACHE_PREFIX}${userId}:${fileId}:${hash}:${version}`;
  }

  getCachedAnalysis<T = any>(file: Pick<ResumeFile, 'fileId' | 'resumeHash' | 'analysisVersion'>): T | null {
    if (!file?.fileId || !file?.resumeHash) return null;
    try {
      const raw = localStorage.getItem(this.buildAnalysisCacheKey(file));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.cachedAt || Date.now() - Number(parsed.cachedAt) > RESUME_ANALYSIS_CACHE_TTL_MS) {
        localStorage.removeItem(this.buildAnalysisCacheKey(file));
        return null;
      }
      return parsed.analysis || null;
    } catch {
      return null;
    }
  }

  cacheAnalysis(file: Pick<ResumeFile, 'fileId' | 'resumeHash' | 'analysisVersion'>, analysis: any): void {
    const resumeHash = String(analysis?.resumeHash || file?.resumeHash || '').trim();
    if (!file?.fileId || !resumeHash) return;
    const key = this.buildAnalysisCacheKey({
      fileId: file.fileId,
      resumeHash,
      analysisVersion: analysis?.analysisVersion || file?.analysisVersion || 'resume-intel-v2'
    });
    localStorage.setItem(key, JSON.stringify({ cachedAt: Date.now(), analysis }));
  }

  clearResumeAnalysisCache(): void {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(RESUME_ANALYSIS_CACHE_PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  }

  // Update a single resume to default
  setDefaultResume(fileId: string): Observable<any> {
    return this.apiService.setActiveResume(fileId, true).pipe(
      tap(() => this.refresh())
    );
  }

  // Upload a resume
  uploadResume(formData: FormData): Observable<any> {
    return this.apiService.uploadResume(formData).pipe(
      tap(() => {
        this.clearResumeAnalysisCache();
        this.refresh();
      })
    );
  }
}
