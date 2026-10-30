import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { UserProfile } from '../../../../shared/services/profile.service';
@Component({
  selector: 'div[appProfileAccountTelemetry]',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './profile-account-telemetry.component.html',
  styleUrl: './profile-account-telemetry.component.scss',
})
export class ProfileAccountTelemetryComponent {
  @Input({ required: true }) profile!: UserProfile;
  @Input({ required: true }) scoreClass!: string;
}
