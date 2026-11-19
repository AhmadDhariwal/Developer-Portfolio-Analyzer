import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  Input,
  inject,
  signal,
} from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { LandingThemeService } from '../../services/landing-theme.service';
import { ThemeMenuComponent } from '../theme-menu/theme-menu.component';

@Component({
  selector: 'app-public-subpage-shell',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive, ThemeMenuComponent],
  templateUrl: './public-subpage-shell.component.html',
  styleUrl: './public-subpage-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicSubpageShellComponent {
  @Input({ required: true }) eyebrow = '';
  @Input({ required: true }) title = '';
  @Input({ required: true }) subtitle = '';
  @Input() metaLabel = '';

  readonly themeService = inject(LandingThemeService);
  readonly mobileMenuOpen = signal(false);
  readonly currentYear = new Date().getFullYear();

  readonly resourceLinks = [
    { label: 'API Docs', route: '/api-docs' },
    { label: 'Blog', route: '/blog' },
    { label: 'Contact', route: '/contact' },
    { label: 'Privacy', route: '/privacy' },
    { label: 'Terms', route: '/terms' },
  ] as const;

  get themeClass(): string {
    return this.themeService.themeClass();
  }

  toggleMobileMenu(): void {
    this.mobileMenuOpen.update((open) => !open);
  }

  closeMobileMenu(): void {
    this.mobileMenuOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.mobileMenuOpen()) {
      this.mobileMenuOpen.set(false);
    }
  }
}
