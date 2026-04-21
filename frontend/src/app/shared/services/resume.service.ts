import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap, map, shareReplay, switchMap, of } from 'rxjs';
import { ProfileService, UserProfile, ResumeContextFile } from './profile.service';
import { ApiService } from './api.service';

export interface ResumeFile {
  fileId: string;
  fileName: string;
  uploadDate: string;
  isAnalyzed: boolean;
  isDefault: boolean;
  isActive: boolean;
}

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

  // Update a single resume to default
  setDefaultResume(fileId: string): Observable<any> {
    return this.apiService.setActiveResume(fileId, true).pipe(
      tap(() => this.refresh())
    );
  }

  // Upload a resume
  uploadResume(formData: FormData): Observable<any> {
    return this.apiService.uploadResume(formData).pipe(
      tap(() => this.refresh())
    );
  }
}
