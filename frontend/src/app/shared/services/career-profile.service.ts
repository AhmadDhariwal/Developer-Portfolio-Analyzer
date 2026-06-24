import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';
import { FrontendAnalysisCacheService } from './frontend-analysis-cache.service';
import { ApiService } from './api.service';
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
  private readonly baseUrl = environment.apiBaseUrl;

  private readonly profileSubject = new BehaviorSubject<CareerProfile>(
    this.loadFromStorage()
  );

  readonly careerProfile$: Observable<CareerProfile> =
    this.profileSubject.asObservable();

  constructor(
    private readonly http: HttpClient,
    private readonly authService: AuthService,
    private readonly frontendCache: FrontendAnalysisCacheService,
    private readonly apiService: ApiService
  ) {}

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
      .pipe(tap((response) => this.applyAndPersist(response, { invalidateCaches: true, syncBaseFields: true })));
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
      .pipe(tap((response) => this.applyAndPersist(response, { invalidateCaches: true, syncBaseFields: false })));
  }

  hydrateFromServer(serverProfile: {
    careerStack?: CareerStack;
    experienceLevel?: ExperienceLevel;
    activeCareerStack?: CareerStack;
    activeExperienceLevel?: ExperienceLevel;
    careerGoal?: CareerGoal;
    isConfigured?: boolean;
  }): void {
    this.applyAndPersist(serverProfile, { invalidateCaches: false, syncBaseFields: true });
  }

  updateLocally(partial: Partial<CareerProfile>): void {
    const next = { ...this.profileSubject.value, ...partial };
    this.profileSubject.next(next);
    this.persistToStorage(next);
  }

  reset(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.profileSubject.next({ ...DEFAULT_CAREER_PROFILE });
    this.authService.updateCurrentUser({
      careerStack: DEFAULT_CAREER_PROFILE.careerStack,
      experienceLevel: DEFAULT_CAREER_PROFILE.experienceLevel,
      activeCareerStack: DEFAULT_CAREER_PROFILE.careerStack,
      activeExperienceLevel: DEFAULT_CAREER_PROFILE.experienceLevel,
      careerGoal: DEFAULT_CAREER_PROFILE.careerGoal
    });
  }

  private applyAndPersist(
    data: Partial<CareerProfile>,
    options: { invalidateCaches?: boolean; syncBaseFields?: boolean } = {}
  ): void {
    const incoming = data as Partial<CareerProfile> & {
      activeCareerStack?: CareerStack;
      activeExperienceLevel?: ExperienceLevel;
    };
    const current = this.profileSubject.value;
    const next: CareerProfile = {
      careerStack: incoming.activeCareerStack ?? data.careerStack ?? current.careerStack,
      experienceLevel: incoming.activeExperienceLevel ?? data.experienceLevel ?? current.experienceLevel,
      careerGoal: data.careerGoal ?? current.careerGoal,
      isConfigured: data.isConfigured ?? current.isConfigured
    };

    this.profileSubject.next(next);
    this.persistToStorage(next);
    this.authService.updateCurrentUser({
      ...(options.syncBaseFields === false ? {} : {
        careerStack: next.careerStack,
        experienceLevel: next.experienceLevel
      }),
      activeCareerStack: next.careerStack,
      activeExperienceLevel: next.experienceLevel,
      careerGoal: next.careerGoal
    });

    if (options.invalidateCaches) {
      this.frontendCache.clearCurrentSignalHash();
      this.apiService.invalidateScenarioContextCache();
      [
        'dashboardSummary',
        'dashboardContributions',
        'dashboardLanguages',
        'dashboardSkills',
        'dashboardRecommendations',
        'dashboardIntegrationAnalytics',
        'recommendations',
        'weeklyReports',
        'news-feed'
      ].forEach((module) => this.frontendCache.clearModule(module));
    }
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




