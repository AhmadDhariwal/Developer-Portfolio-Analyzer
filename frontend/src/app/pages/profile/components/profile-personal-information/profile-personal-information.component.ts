import type { UserProfile } from '../../../../shared/services/profile.service';
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'section[appProfilePersonalInformation]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-personal-information.component.html',
  styleUrl: './profile-personal-information.component.scss',
})
export class ProfilePersonalInformationComponent {
  @Input({ required: true }) profile!: UserProfile;
}
