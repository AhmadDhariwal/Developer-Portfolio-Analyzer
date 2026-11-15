import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ThemeMenuComponent } from '../../../../shared/components/theme-menu/theme-menu.component';
import { LandingThemeService } from '../../../../shared/services/landing-theme.service';

export interface AuthShowcaseItem {
  icon: 'chart' | 'calendar' | 'layers' | 'github' | 'award' | 'target';
  title: string;
  description: string;
}

@Component({
  selector: 'app-auth-shell',
  standalone: true,
  imports: [CommonModule, RouterLink, ThemeMenuComponent],
  templateUrl: './auth-shell.component.html',
  styleUrl: './auth-shell.component.scss',
})
export class AuthShellComponent {
  @Input() mode: 'split' | 'centered' = 'centered';
  @Input() badge = 'Build · Analyze · Prepare · Grow';
  @Input() showcaseTitle = 'Welcome to your';
  @Input() showcaseHighlight = 'Developer Workspace';
  @Input() showcaseSubtitle =
    'Analyze your GitHub repositories, resume readiness, skill gaps, career sprints, and interview preparation in one place.';
  @Input() highlights: AuthShowcaseItem[] = [];
  @Input() backLink = '/';
  @Input() backLabel = 'Back to home';
  @Input() topPrompt?: string;
  @Input() topCtaLabel?: string;
  @Input() topCtaLink?: string;

  constructor(readonly themeService: LandingThemeService) {}

  get themeClass(): string {
    return this.themeService.themeClass();
  }
}
