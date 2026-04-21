import { Injectable, inject, DestroyRef } from '@angular/core';
import { Router, NavigationEnd } from '@angular/router';
import { BehaviorSubject, combineLatest, debounceTime, filter } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ResumeService } from './resume.service';

export type OnboardingPopupState = 'UPLOAD' | 'SET_DEFAULT' | null;
export type DismissMode = 'later' | 'tomorrow' | 'never';

export interface OnboardingStatus {
  state: OnboardingPopupState;
  loading: boolean;
}

const DISMISSED_AT_KEY      = 'devinsight_resume_prompt_dismissed_at';
const DISMISSED_STATE_KEY   = 'devinsight_resume_prompt_dismissed_state';
const PERMANENT_DISMISS_KEY = 'devinsight_resume_prompt_permanent_dismiss';
const COOLDOWN_MS           = 24 * 60 * 60 * 1000; // 24 hours

@Injectable({ providedIn: 'root' })
export class ResumeOnboardingService {
  private readonly router        = inject(Router);
  private readonly resumeService = inject(ResumeService);
  private readonly destroyRef    = inject(DestroyRef);

  private readonly statusSubject = new BehaviorSubject<OnboardingStatus>({ state: null, loading: false });
  status$ = this.statusSubject.asObservable();

  /**
   * 'later'    – closed via ✕ or "Remind me later"; suppressed for this session only.
   * 'tomorrow' – "Remind me tomorrow"; suppressed for 24 h (persisted).
   * null       – not dismissed.
   */
  private sessionDismissMode: DismissMode | null = null;
  private sessionDismissedState: OnboardingPopupState = null;

  constructor() {
    this.init();
  }

  private init(): void {
    this.router.events.pipe(
      filter(event => event instanceof NavigationEnd),
      debounceTime(200),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(() => this.evaluate());

    combineLatest([
      this.resumeService.profile$,
      this.resumeService.resumes$,
      this.resumeService.loading$
    ]).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([, , loading]) => {
      if (!loading) {
        this.evaluate();
      } else {
        this.statusSubject.next({ ...this.statusSubject.value, loading: true });
      }
    });
  }

  public evaluate(): void {
    // Permanent "never show again"
    if (localStorage.getItem(PERMANENT_DISMISS_KEY) === 'true') {
      this.setPopupState(null);
      return;
    }

    const currentState = this.calculateState();

    if (!currentState) {
      this.setPopupState(null);
      return;
    }

    // If the underlying state changed (e.g. user uploaded a resume), reset session dismiss
    if (this.sessionDismissMode && currentState !== this.sessionDismissedState) {
      this.sessionDismissMode = null;
    }

    // Session-level "later" suppression
    if (this.sessionDismissMode === 'later' && currentState === this.sessionDismissedState) {
      this.setPopupState(null);
      return;
    }

    // 24-hour cooldown for "tomorrow"
    if (this.sessionDismissMode === 'tomorrow' || localStorage.getItem(DISMISSED_AT_KEY)) {
      const dismissedState = localStorage.getItem(DISMISSED_STATE_KEY);
      const dismissedAt    = localStorage.getItem(DISMISSED_AT_KEY);
      if (dismissedAt && dismissedState === currentState) {
        const elapsed = Date.now() - parseInt(dismissedAt, 10);
        if (elapsed < COOLDOWN_MS) {
          this.setPopupState(null);
          return;
        }
        // Cooldown expired — clear it so the popup shows again
        localStorage.removeItem(DISMISSED_AT_KEY);
        localStorage.removeItem(DISMISSED_STATE_KEY);
      }
    }

    this.setPopupState(currentState);
  }

  private calculateState(): OnboardingPopupState {
    const profile = this.resumeService.profileSubjectValue();
    const resumes = this.resumeService.resumesSubjectValue();

    if (!profile) return null;

    if (!resumes || resumes.length === 0) return 'UPLOAD';

    const hasDefault = resumes.some(r => r.isDefault) || !!profile.defaultResume;
    if (!hasDefault) return 'SET_DEFAULT';

    return null;
  }

  private setPopupState(state: OnboardingPopupState): void {
    this.statusSubject.next({ state, loading: false });
  }

  /**
   * Dismiss the popup.
   * - 'later'    → session-only, no persistence (✕ button or "Remind me later")
   * - 'tomorrow' → persisted 24-hour cooldown
   * - 'never'    → persisted permanent suppression
   */
  dismiss(mode: DismissMode = 'later'): void {
    const currentState = this.calculateState();
    this.sessionDismissMode    = mode;
    this.sessionDismissedState = currentState;

    if (mode === 'never') {
      localStorage.setItem(PERMANENT_DISMISS_KEY, 'true');
    } else if (mode === 'tomorrow') {
      localStorage.setItem(DISMISSED_AT_KEY,    Date.now().toString());
      localStorage.setItem(DISMISSED_STATE_KEY, currentState ?? '');
    }

    this.setPopupState(null);
  }

  /**
   * Call this right after a new user completes signup + OTP verification
   * so the popup shows immediately, bypassing any previous dismissal state.
   */
  triggerForNewUser(): void {
    this.sessionDismissMode    = null;
    this.sessionDismissedState = null;
    localStorage.removeItem(DISMISSED_AT_KEY);
    localStorage.removeItem(DISMISSED_STATE_KEY);
    localStorage.removeItem(PERMANENT_DISMISS_KEY);
    this.resumeService.refresh();
    // evaluate() will fire automatically once resume state updates
  }

  resetDismissal(): void {
    localStorage.removeItem(DISMISSED_AT_KEY);
    localStorage.removeItem(DISMISSED_STATE_KEY);
    localStorage.removeItem(PERMANENT_DISMISS_KEY);
    this.sessionDismissMode    = null;
    this.sessionDismissedState = null;
    this.evaluate();
  }
}
