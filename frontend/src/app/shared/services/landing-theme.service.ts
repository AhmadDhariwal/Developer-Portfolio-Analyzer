import { Injectable, signal } from '@angular/core';

export type LandingThemeId = 'dark' | 'light' | 'premium';

export interface LandingThemeOption {
  id: LandingThemeId;
  label: string;
  description: string;
}

const STORAGE_KEY = 'landing-theme';
const LEGACY_MAP: Record<string, LandingThemeId> = {
  navy: 'dark',
  cream: 'light',
  special: 'premium',
};

@Injectable({ providedIn: 'root' })
export class LandingThemeService {
  readonly themes: readonly LandingThemeOption[] = [
    { id: 'dark', label: 'Dark', description: 'Default' },
    { id: 'light', label: 'Light', description: 'Light' },
    { id: 'premium', label: 'Premium', description: 'Premium' },
  ] as const;

  private readonly themeSignal = signal<LandingThemeId>(this.readSavedTheme());
  readonly theme = this.themeSignal.asReadonly();

  get selectedTheme(): LandingThemeId {
    return this.themeSignal();
  }

  setTheme(theme: LandingThemeId): void {
    if (!this.themes.some((item) => item.id === theme)) {
      return;
    }
    this.themeSignal.set(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Theme selection remains usable when storage is unavailable.
    }
  }

  themeClass(theme: LandingThemeId = this.selectedTheme): string {
    return `theme--${theme}`;
  }

  private readSavedTheme(): LandingThemeId {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        return 'dark';
      }
      const normalized = LEGACY_MAP[saved] ?? saved;
      return this.themes.some((theme) => theme.id === normalized)
        ? (normalized as LandingThemeId)
        : 'dark';
    } catch {
      return 'dark';
    }
  }
}
