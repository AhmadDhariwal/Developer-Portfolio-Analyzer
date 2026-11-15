import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { LandingPageComponent } from './landing-page.component';
import { LandingThemeService } from '../../shared/services/landing-theme.service';

describe('LandingPageComponent', () => {
  let component: LandingPageComponent;
  let fixture: ComponentFixture<LandingPageComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LandingPageComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('renders real DPA feature sections and auth CTA routes', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Developer Portfolio Analyzer');
    expect(el.textContent).toContain('GitHub Repository Analysis');
    expect(el.textContent).toContain('Interview Preparation');

    const signupLinks = el.querySelectorAll('a[href="/auth/signup"]');
    const loginLinks = el.querySelectorAll('a[href="/auth/login"]');
    expect(signupLinks.length).toBeGreaterThanOrEqual(2);
    expect(loginLinks.length).toBeGreaterThanOrEqual(2);
  });

  it('toggles and closes mobile menu via Escape', () => {
    expect(component.mobileMenuOpen).toBe(false);
    component.toggleMobileMenu();
    expect(component.mobileMenuOpen).toBe(true);
    component.onEscape();
    expect(component.mobileMenuOpen).toBe(false);
  });

  it('switches analysis preview tabs between GitHub and Resume', () => {
    expect(component.activeSignalTab).toBe('github');
    component.selectSignalTab('resume');
    expect(component.currentSignal.id).toBe('resume');
  });

  it('switches between light, dark, and system themes via LandingThemeService', () => {
    const themeService = TestBed.inject(LandingThemeService);
    component.selectTheme('light');
    expect(themeService.selectedTheme).toBe('light');
    expect(component.themeClass).toBe('theme--light');

    component.selectTheme('dark');
    expect(themeService.selectedTheme).toBe('dark');
    expect(component.themeClass).toBe('theme--dark');

    component.selectTheme('system');
    expect(themeService.selectedTheme).toBe('system');
  });
});
