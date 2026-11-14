import type { UserProfile } from '../../../../shared/services/profile.service';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'section[appProfileVisibilitySettings]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-visibility-settings.component.html',
  styleUrl: './profile-visibility-settings.component.scss',
})
export class ProfileVisibilitySettingsComponent {
  @Input({ required: true }) profile!: UserProfile;
  @Input({ required: true }) isTogglingVisibility!: boolean;
  @Input({ required: true }) visibilityMessage!: string;
  @Output() toggleVisibilityIntent = new EventEmitter<void>();
  toggleVisibility(): void {
    this.toggleVisibilityIntent.emit();
  }
}
