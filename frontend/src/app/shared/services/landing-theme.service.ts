import { Injectable, OnDestroy, computed, signal } from '@angular/core';

export type LandingThemeId = 'dark' | 'light' | 'system' | 'premium';
export type ResolvedLandingThemeId = 'dark' | 'light' | 'premium';

export interface LandingThemeOption {
  id: LandingThemeId;
  label: string;
  description: string;
}

const STORAGE_KEY = 'landing-theme';
const APP_STORAGE_KEY = 'devinsight_theme';
const LEGACY_MAP: Record<string, LandingThemeId> = {
  navy: 'dark',
  cream: 'light',
  special: 'premium',
};

@Injectable({ providedIn: 'root' })
export class LandingThemeService implements OnDestroy {
  readonly themes: readonly LandingThemeOption[] = [
    { id: 'light', label: 'Light', description: 'Clean daylight workspace' },
    { id: 'dark', label: 'Dark', description: 'Low-glare developer workspace' },
    { id: 'system', label: 'System', description: 'Follow operating system setting' },
  ] as const;

  private readonly systemDarkSignal = signal<boolean>(this.readSystemPrefersDark());
  private readonly themeSignal = signal<LandingThemeId>(this.readSavedTheme());
  readonly theme = this.themeSignal.asReadonly();
  readonly resolvedTheme = computed<ResolvedLandingThemeId>(() =>
    this.resolveTheme(this.themeSignal()),
  );

  private mediaQuery?: MediaQueryList;
  private readonly mediaListener = (event: MediaQueryListEvent): void => {
    this.systemDarkSignal.set(event.matches);
    if (this.themeSignal() === 'system') {
      this.syncDocumentTheme('system');
    }
  };

  constructor() {
    this.attachSystemListener();
    this.syncDocumentTheme(this.themeSignal());
  }

  get selectedTheme(): LandingThemeId {
    return this.themeSignal();
  }

  setTheme(theme: LandingThemeId): void {
    const allowed: readonly LandingThemeId[] = ['light', 'dark', 'system', 'premium'];
    if (!allowed.includes(theme)) {
      return;
    }
    this.themeSignal.set(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
      const appTheme = theme === 'premium' ? 'dark' : theme;
      localStorage.setItem(APP_STORAGE_KEY, appTheme);
    } catch {
      // Theme selection remains usable when storage is unavailable.
    }
    this.syncDocumentTheme(theme);
  }

  resolveTheme(theme: LandingThemeId = this.selectedTheme): ResolvedLandingThemeId {
    if (theme === 'system') {
      return this.systemDarkSignal() ? 'dark' : 'light';
    }
    return theme;
  }

  themeClass(theme: LandingThemeId = this.selectedTheme): string {
    return `theme--${this.resolveTheme(theme)}`;
  }

  ngOnDestroy(): void {
    if (this.mediaQuery) {
      if (typeof this.mediaQuery.removeEventListener === 'function') {
        this.mediaQuery.removeEventListener('change', this.mediaListener);
      } else if (typeof this.mediaQuery.removeListener === 'function') {
        this.mediaQuery.removeListener(this.mediaListener);
      }
    }
  }

  private attachSystemListener(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.systemDarkSignal.set(this.mediaQuery.matches);
    if (typeof this.mediaQuery.addEventListener === 'function') {
      this.mediaQuery.addEventListener('change', this.mediaListener);
    } else if (typeof this.mediaQuery.addListener === 'function') {
      this.mediaQuery.addListener(this.mediaListener);
    }
  }

  private syncDocumentTheme(theme: LandingThemeId): void {
    if (typeof document === 'undefined' || !document.documentElement) {
      return;
    }
    const resolved = this.resolveTheme(theme);
    const attrTheme = resolved === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', attrTheme);
    if (attrTheme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }
  }

  private readSystemPrefersDark(): boolean {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private readSavedTheme(): LandingThemeId {
    try {
      const saved =
        localStorage.getItem(APP_STORAGE_KEY) ||
        localStorage.getItem(STORAGE_KEY) ||
        (typeof document !== 'undefined' && document.documentElement
          ? document.documentElement.getAttribute('data-theme')
          : null);
      if (!saved) {
        return 'system';
      }
      const normalized = LEGACY_MAP[saved] ?? saved;
      const valid: readonly LandingThemeId[] = ['light', 'dark', 'system', 'premium'];
      return valid.includes(normalized as LandingThemeId)
        ? (normalized as LandingThemeId)
        : 'system';
    } catch {
      return 'system';
    }
  }
}
