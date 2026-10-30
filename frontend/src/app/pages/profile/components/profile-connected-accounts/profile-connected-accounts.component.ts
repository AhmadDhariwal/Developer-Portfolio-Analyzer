import type { UserProfile } from '../../../../shared/services/profile.service';
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'section[appProfileConnectedAccounts]',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './profile-connected-accounts.component.html',
  styleUrl: './profile-connected-accounts.component.scss',
})
export class ProfileConnectedAccountsComponent {
  @Input({ required: true }) profile!: UserProfile;
}
