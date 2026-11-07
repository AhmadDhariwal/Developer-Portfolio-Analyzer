import type { UserProfile } from '../../../../shared/services/profile.service';
import type { NotificationPrefs } from '../../../../shared/services/profile.service';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'section[appProfileNotificationSettings]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-notification-settings.component.html',
  styleUrl: './profile-notification-settings.component.scss',
})
export class ProfileNotificationSettingsComponent {
  @Input({ required: true }) profile!: UserProfile;
  @Output() toggleNotificationIntent = new EventEmitter<keyof NotificationPrefs>();
  toggleNotification(key: keyof NotificationPrefs): void {
    this.toggleNotificationIntent.emit(key);
  }
}
