import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  Input,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import {
  LandingThemeId,
  LandingThemeOption,
  LandingThemeService,
} from '../../services/landing-theme.service';

@Component({
  selector: 'app-theme-menu',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './theme-menu.component.html',
  styleUrl: './theme-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ThemeMenuComponent {
  @Input() compactMobileLabel = true;
  @Input() fullWidth = false;
  @Input() inlineMenu = false;

  @ViewChild('triggerButton') triggerButton?: ElementRef<HTMLButtonElement>;

  private readonly hostEl = inject(ElementRef<HTMLElement>);
  readonly themeService = inject(LandingThemeService);
  readonly isOpen = signal(false);

  get themes(): readonly LandingThemeOption[] {
    return this.themeService.themes;
  }

  get selectedTheme(): LandingThemeId {
    return this.themeService.selectedTheme;
  }

  get currentOption(): LandingThemeOption {
    return this.themes.find((item) => item.id === this.selectedTheme) ?? this.themes[0];
  }

  toggleMenu(): void {
    this.isOpen.update((open) => !open);
  }

  selectTheme(theme: LandingThemeId): void {
    this.themeService.setTheme(theme);
    this.isOpen.set(false);
    this.triggerButton?.nativeElement.focus();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) {
      return;
    }
    const target = event.target as Node | null;
    if (target && !this.hostEl.nativeElement.contains(target)) {
      this.isOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.isOpen()) {
      return;
    }
    this.isOpen.set(false);
    this.triggerButton?.nativeElement.focus();
  }
}
