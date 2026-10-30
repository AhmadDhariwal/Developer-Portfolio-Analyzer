import type { ThemeService } from '../../../../shared/services/theme.service';
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'section[appProfileAppearanceSettings]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-appearance-settings.component.html',
  styleUrl: './profile-appearance-settings.component.scss',
})
export class ProfileAppearanceSettingsComponent {
  @Input({ required: true }) themeService!: ThemeService;
}
