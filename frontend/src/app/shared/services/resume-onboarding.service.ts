import { Injectable, inject, DestroyRef } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { BehaviorSubject, combineLatest, debounceTime, filter, map, takeUntil } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ResumeService } from './resume.service';

export type OnboardingPopupState = 'UPLOAD' | 'SET_DEFAULT' | null;

export interface OnboardingStatus {
  state: OnboardingPopupState;
  loading: boolean;
}

const DISMISSED_AT_KEY = 'devinsight_resume_prompt_dismissed_at';
const PERMANENT_DISMISS_KEY = 'devinsight_resume_prompt_permanent_dismiss';
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours

@Injectable({
  providedIn: 'root'
})
export class ResumeOnboardingService {
  private readonly router = inject(Router);
  private readonly resumeService = inject(ResumeService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly statusSubject = new BehaviorSubject<OnboardingStatus>({
    state: null,
    loading: false
  });
  status$ = this.statusSubject.asObservable();

  private isClosedManually = false;
  private lastDismissedState: OnboardingPopupState = null;

  constructor() {
    this.init();
  }

  private init(): void {
    // Listen to router events with debounce to trigger evaluation
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      debounceTime(200),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => {
      this.evaluate();
    });

    // Also listen to resume state changes to auto-close or update
    combineLatest([
      this.resumeService.profile$,
      this.resumeService.resumes$,
      this.resumeService.loading$
    ]).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([profile, resumes, loading]) => {
      if (!loading) {
        this.evaluate();
      } else {
        this.statusSubject.next({ ...this.statusSubject.value, loading: true });
      }
    });
  }

  public evaluate(): void {
    const permanentDismiss = localStorage.getItem(PERMANENT_DISMISS_KEY) === 'true';
    if (permanentDismiss) {
      this.setPopupState(null);
      return;
    }

    const currentState = this.calculateState();
    
    // If there is nothing to show, just update and return
    if (!currentState) {
      this.setPopupState(null);
      return;
    }

    // If the state has changed since the last dismissal, reset the session-level manual close flag
    if (this.isClosedManually && currentState !== this.lastDismissedState) {
      this.isClosedManually = false;
    }

    // If it was manually closed in this session and it's still the same state, don't show
    if (this.isClosedManually) {
      this.setPopupState(null);
      return;
    }

    // Check cooldown ONLY if the state is the same as the one dismissed
    const lastDismissedTime = localStorage.getItem(DISMISSED_AT_KEY);
    if (lastDismissedTime && currentState === this.lastDismissedState) {
      const diff = Date.now() - parseInt(lastDismissedTime, 10);
      if (diff < COOLDOWN_MS) {
        this.setPopupState(null);
        return;
      }
    }

    this.setPopupState(currentState);
  }

  private calculateState(): OnboardingPopupState {
    const profile = this.resumeService.profileSubjectValue(); // Helper to get sync value
    const resumes = this.resumeService.resumesSubjectValue();

    if (!profile) return null;

    // 1. No resumes uploaded at all
    if (!resumes || resumes.length === 0) {
      return 'UPLOAD';
    }

    // 2. Resumes exist but no default set
    const hasDefault = resumes.some(r => r.isDefault) || !!profile.defaultResume;
    if (!hasDefault) {
      return 'SET_DEFAULT';
    }

    return null;
  }

  private setPopupState(state: OnboardingPopupState): void {
    this.statusSubject.next({
      state,
      loading: false
    });
  }

  dismiss(permanent = false): void {
    this.lastDismissedState = this.calculateState();
    
    if (permanent) {
      localStorage.setItem(PERMANENT_DISMISS_KEY, 'true');
    } else {
      localStorage.setItem(DISMISSED_AT_KEY, Date.now().toString());
    }
    
    this.isClosedManually = true;
    this.setPopupState(null);
  }

  resetDismissal(): void {
    localStorage.removeItem(DISMISSED_AT_KEY);
    localStorage.removeItem(PERMANENT_DISMISS_KEY);
    this.isClosedManually = false;
    this.evaluate();
  }
}
