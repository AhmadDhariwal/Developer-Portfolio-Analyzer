import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import {
  CareerProfile,
  CareerStack,
  ExperienceLevel,
  CareerGoal,
  DEFAULT_CAREER_PROFILE
} from '../models/career-profile.model';

const STORAGE_KEY = 'devinsight_career_profile';

@Injectable({ providedIn: 'root' })
export class CareerProfileService {
  private readonly baseUrl = 'http://localhost:5000/api';

  private readonly profileSubject = new BehaviorSubject<CareerProfile>(
    this.loadFromStorage()
  );

  /** Observable every module subscribes to for reactive updates */
  readonly careerProfile$: Observable<CareerProfile> =
    this.profileSubject.asObservable();

  constructor(private readonly http: HttpClient) {}

  // ── Snapshots ────────────────────────────────────────────────────────────

  get snapshot(): CareerProfile {
    return this.profileSubject.value;
  }

  get careerStack(): CareerStack {
    return this.profileSubject.value.careerStack;
  }

  get experienceLevel(): ExperienceLevel {
    return this.profileSubject.value.experienceLevel;
  }

  get isConfigured(): boolean {
    return this.profileSubject.value.isConfigured;
  }

  // ── Remote write ─────────────────────────────────────────────────────────

  /**
   * Persists the career profile to the server and then updates local state.
   * Call this from the onboarding modal and the profile settings page.
   */
  saveCareerProfile(
    careerStack: CareerStack,
    experienceLevel: ExperienceLevel,
    careerGoal: CareerGoal = ''
  ): Observable<CareerProfile> {
    return this.http
      .put<CareerProfile>(`${this.baseUrl}/profile/career`, {
        careerStack,
        experienceLevel,
        careerGoal
      })
      .pipe(tap(response => this.applyAndPersist(response)));
  }

  setActiveCareerProfile(
    careerStack: CareerStack,
    experienceLevel: ExperienceLevel
  ): Observable<CareerProfile> {
    return this.http
      .put<CareerProfile>(`${this.baseUrl}/profile/career/active`, {
        careerStack,
        experienceLevel
      })
      .pipe(tap(response => this.applyAndPersist(response)));
  }

  // ── Hydration ────────────────────────────────────────────────────────────

  /**
   * Hydrates local state from the server response.
   * Call this inside ProfileService.getProfile() after login or page refresh.
   */
  hydrateFromServer(serverProfile: {
    careerStack?: CareerStack;
    experienceLevel?: ExperienceLevel;
    activeCareerStack?: CareerStack;
    activeExperienceLevel?: ExperienceLevel;
    careerGoal?: CareerGoal;
    isConfigured?: boolean;
  }): void {
    this.applyAndPersist(serverProfile);
  }

  // ── Optimistic local update ───────────────────────────────────────────────

  /**
   * Updates state locally without a server call.
   * Use for immediate UI feedback before save completes.
   */
  updateLocally(partial: Partial<CareerProfile>): void {
    const next = { ...this.profileSubject.value, ...partial };
    this.profileSubject.next(next);
    this.persistToStorage(next);
  }

  // ── Reset ────────────────────────────────────────────────────────────────

  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.profileSubject.next({ ...DEFAULT_CAREER_PROFILE });
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private applyAndPersist(data: Partial<CareerProfile>): void {
    const incoming = data as Partial<CareerProfile> & {
      activeCareerStack?: CareerStack;
      activeExperienceLevel?: ExperienceLevel;
    };
    const current = this.profileSubject.value;
    const next: CareerProfile = {
      careerStack:     incoming.activeCareerStack ?? data.careerStack ?? current.careerStack,
      experienceLevel: incoming.activeExperienceLevel ?? data.experienceLevel ?? current.experienceLevel,
      careerGoal:      data.careerGoal      ?? current.careerGoal,
      isConfigured:    data.isConfigured    ?? current.isConfigured
    };
    this.profileSubject.next(next);
    this.persistToStorage(next);
  }

  private persistToStorage(profile: CareerProfile): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  private loadFromStorage(): CareerProfile {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_CAREER_PROFILE };
      return { ...DEFAULT_CAREER_PROFILE, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULT_CAREER_PROFILE };
    }
  }
}
