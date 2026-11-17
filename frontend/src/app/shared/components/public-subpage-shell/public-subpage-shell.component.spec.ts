import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { PublicSubpageShellComponent } from './public-subpage-shell.component';
import { LandingThemeService } from '../../services/landing-theme.service';

describe('PublicSubpageShellComponent', () => {
  let component: PublicSubpageShellComponent;
  let fixture: ComponentFixture<PublicSubpageShellComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicSubpageShellComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicSubpageShellComponent);
    component = fixture.componentInstance;
    component.eyebrow = 'Trust Center';
    component.title = 'Privacy Policy';
    component.subtitle = 'How DevInsight AI protects developer and recruiter data.';
    fixture.detectChanges();
  });

  it('renders header navigation links, theme selector, and hero copy', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Privacy Policy');
    expect(el.querySelector('app-theme-menu')).toBeTruthy();
    expect(el.querySelector('a[href="/api-docs"]')).toBeTruthy();
    expect(el.querySelector('a[href="/blog"]')).toBeTruthy();
    expect(el.querySelector('a[href="/contact"]')).toBeTruthy();
    expect(el.querySelector('a[href="/privacy"]')).toBeTruthy();
    expect(el.querySelector('a[href="/terms"]')).toBeTruthy();
  });

  it('toggles mobile drawer and closes on Escape', () => {
    const themeService = TestBed.inject(LandingThemeService);
    themeService.setTheme('light');
    fixture.detectChanges();
    expect(component.themeClass).toBe('theme--light');

    component.toggleMobileMenu();
    expect(component.mobileMenuOpen()).toBe(true);
    component.onEscape();
    expect(component.mobileMenuOpen()).toBe(false);
  });
});

