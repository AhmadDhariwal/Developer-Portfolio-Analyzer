import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeMenuComponent } from './theme-menu.component';
import { LandingThemeService } from '../../services/landing-theme.service';

describe('ThemeMenuComponent', () => {
  let component: ThemeMenuComponent;
  let fixture: ComponentFixture<ThemeMenuComponent>;
  let themeService: LandingThemeService;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ThemeMenuComponent],
    }).compileComponents();

    themeService = TestBed.inject(LandingThemeService);
    themeService.setTheme('dark');

    fixture = TestBed.createComponent(ThemeMenuComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('opens menu popover, selects theme option, and closes on selection or Escape', () => {
    const el: HTMLElement = fixture.nativeElement;
    const trigger = el.querySelector('.theme-menu-trigger') as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    const lightItem = el.querySelector(
      'button[aria-label="Switch to Light theme"]',
    ) as HTMLButtonElement;
    expect(lightItem).toBeTruthy();
    lightItem.click();
    fixture.detectChanges();

    expect(themeService.selectedTheme).toBe('light');
    expect(component.isOpen()).toBe(false);

    trigger.click();
    fixture.detectChanges();
    expect(component.isOpen()).toBe(true);

    component.onEscape();
    fixture.detectChanges();
    expect(component.isOpen()).toBe(false);
  });

  it('closes when clicking outside the dropdown menu', () => {
    component.toggleMenu();
    fixture.detectChanges();
    expect(component.isOpen()).toBe(true);

    document.body.click();
    fixture.detectChanges();
    expect(component.isOpen()).toBe(false);
  });
});

