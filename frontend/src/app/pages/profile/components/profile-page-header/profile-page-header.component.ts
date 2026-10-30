import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { UserProfile } from '../../../../shared/services/profile.service';
@Component({
  selector: 'header[appProfilePageHeader]',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './profile-page-header.component.html',
  styleUrl: './profile-page-header.component.scss',
})
export class ProfilePageHeaderComponent {
  @Input({ required: true }) isLoading!: boolean;
  @Output() refreshProfileIntent = new EventEmitter<void>();
}
