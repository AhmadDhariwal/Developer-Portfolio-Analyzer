import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { ThemeService, THEME_STORAGE_KEY } from './theme.service';

describe('ThemeService', () => {
  let service: ThemeService;
  let storageMap: Map<string, string>;
  let htmlElement: HTMLElement;
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    storageMap = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storageMap.get(key) ?? null,
      setItem: (key: string, value: string) => storageMap.set(key, value),
      removeItem: (key: string) => storageMap.delete(key),
      clear: () => storageMap.clear(),
    });

    htmlElement = document.documentElement;
    htmlElement.removeAttribute('data-theme');
    htmlElement.classList.remove('light', 'dark');

    // Default mock for window.matchMedia
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false, // light by default
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('initializes with default light theme when storage is empty', () => {
    service = new ThemeService();

    expect(service.preference()).toBe('light');
    expect(service.activeTheme()).toBe('light');
    expect(service.isDark()).toBe(false);
    expect(htmlElement.getAttribute('data-theme')).toBe('light');
    expect(htmlElement.classList.contains('light')).toBe(true);
    expect(htmlElement.classList.contains('dark')).toBe(false);
  });

  it('restores dark preference saved in localStorage', () => {
    storageMap.set(THEME_STORAGE_KEY, 'dark');
    service = new ThemeService();

    expect(service.preference()).toBe('dark');
    expect(service.activeTheme()).toBe('dark');
    expect(service.isDark()).toBe(true);
    expect(htmlElement.getAttribute('data-theme')).toBe('dark');
    expect(htmlElement.classList.contains('dark')).toBe(true);
  });

  it('updates signals, DOM attributes, classes, and persists when setTheme("dark") is called', () => {
    service = new ThemeService();
    expect(service.isDark()).toBe(false);

    service.setTheme('dark');

    expect(service.preference()).toBe('dark');
    expect(service.activeTheme()).toBe('dark');
    expect(service.isDark()).toBe(true);
    expect(storageMap.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(htmlElement.getAttribute('data-theme')).toBe('dark');
    expect(htmlElement.classList.contains('dark')).toBe(true);
    expect(htmlElement.classList.contains('light')).toBe(false);
  });

  it('cycles between dark and light with toggleTheme()', () => {
    service = new ThemeService();
    expect(service.activeTheme()).toBe('light');

    service.toggleTheme();
    expect(service.activeTheme()).toBe('dark');
    expect(service.isDark()).toBe(true);
    expect(storageMap.get(THEME_STORAGE_KEY)).toBe('dark');

    service.toggleTheme();
    expect(service.activeTheme()).toBe('light');
    expect(service.isDark()).toBe(false);
    expect(storageMap.get(THEME_STORAGE_KEY)).toBe('light');
  });

  it('resolves system theme matching prefers-color-scheme dark query', () => {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true, // OS dark mode
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    service = new ThemeService();
    service.setTheme('system');

    expect(service.preference()).toBe('system');
    expect(service.activeTheme()).toBe('dark');
    expect(service.isDark()).toBe(true);
    expect(storageMap.get(THEME_STORAGE_KEY)).toBe('system');
    expect(htmlElement.getAttribute('data-theme')).toBe('dark');
  });

  it('ignores invalid preference values', () => {
    service = new ThemeService();
    service.setTheme('invalid-theme' as any);

    expect(service.preference()).toBe('light');
    expect(service.activeTheme()).toBe('light');
  });
});
