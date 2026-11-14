import { Injectable, signal, computed, inject, DestroyRef } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ActiveTheme = 'light' | 'dark';

export interface ThemeOption {
  id: ThemePreference;
  label: string;
  icon: string;
  description: string;
}

export const THEME_STORAGE_KEY = 'devinsight_theme';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  private destroyRef: DestroyRef | null = null;

  readonly themeOptions: readonly ThemeOption[] = [
    {
      id: 'light',
      label: 'Light',
      icon: 'sun',
      description: 'Clean light workspace with branded dark sidebar'
    },
    {
      id: 'dark',
      label: 'Dark',
      icon: 'moon',
      description: 'Coordinated dark mode for low-light environments'
    },
    {
      id: 'system',
      label: 'System',
      icon: 'monitor',
      description: 'Match your operating system appearance automatically'
    }
  ];

  // Preference chosen by user: 'light' | 'dark' | 'system'
  private readonly preferenceSignal = signal<ThemePreference>(this.readInitialPreference());
  readonly preference = this.preferenceSignal.asReadonly();

  // Actual active theme applied to DOM: 'light' | 'dark'
  private readonly activeThemeSignal = signal<ActiveTheme>(this.resolveActiveTheme(this.preferenceSignal()));
  readonly activeTheme = this.activeThemeSignal.asReadonly();

  // Convenience computed boolean
  readonly isDark = computed(() => this.activeThemeSignal() === 'dark');

  private mediaQuery: MediaQueryList | null = null;
  private mediaListener: ((e: MediaQueryListEvent) => void) | null = null;

  constructor() {
    try {
      this.destroyRef = inject(DestroyRef, { optional: true });
    } catch {
      this.destroyRef = null;
    }
    this.initMediaQueryListener();
    this.applyThemeToDom(this.activeThemeSignal());
  }

  setTheme(preference: ThemePreference): void {
    if (preference !== 'light' && preference !== 'dark' && preference !== 'system') {
      return;
    }
    this.preferenceSignal.set(preference);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, preference);
    } catch {
      // Storage unavailable fallback
    }

    const resolved = this.resolveActiveTheme(preference);
    this.activeThemeSignal.set(resolved);
    this.applyThemeToDom(resolved);
  }

  toggleTheme(): void {
    const current = this.activeThemeSignal();
    this.setTheme(current === 'dark' ? 'light' : 'dark');
  }

  getTheme(): ThemePreference {
    return this.preferenceSignal();
  }

  getActiveTheme(): ActiveTheme {
    return this.activeThemeSignal();
  }

  private resolveActiveTheme(preference: ThemePreference): ActiveTheme {
    if (preference === 'system') {
      return this.getSystemPreference();
    }
    return preference;
  }

  private getSystemPreference(): ActiveTheme {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }

  private readInitialPreference(): ThemePreference {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference;
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        return saved;
      }
    } catch {
      // Fallback
    }
    return 'light'; // Default is Light
  }

  private initMediaQueryListener(): void {
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.mediaListener = (e: MediaQueryListEvent) => {
        if (this.preferenceSignal() === 'system') {
          const resolved: ActiveTheme = e.matches ? 'dark' : 'light';
          this.activeThemeSignal.set(resolved);
          this.applyThemeToDom(resolved);
        }
      };

      if (this.mediaQuery.addEventListener) {
        this.mediaQuery.addEventListener('change', this.mediaListener);
      } else if ((this.mediaQuery as any).addListener) {
        (this.mediaQuery as any).addListener(this.mediaListener);
      }

      this.destroyRef?.onDestroy(() => {
        if (this.mediaQuery && this.mediaListener) {
          if (this.mediaQuery.removeEventListener) {
            this.mediaQuery.removeEventListener('change', this.mediaListener);
          } else if ((this.mediaQuery as any).removeListener) {
            (this.mediaQuery as any).removeListener(this.mediaListener);
          }
        }
      });
    }
  }

  private applyThemeToDom(theme: ActiveTheme): void {
    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.setAttribute('data-theme', theme);
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
        document.documentElement.classList.remove('light');
      } else {
        document.documentElement.classList.add('light');
        document.documentElement.classList.remove('dark');
      }
    }
  }
}
