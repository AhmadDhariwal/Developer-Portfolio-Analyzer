import type { UserProfile } from '../../../../shared/services/profile.service';
import type { CareerStack, ExperienceLevel } from '../../../../shared/models/career-profile.model';
import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'section[appProfileCareerPreferences]',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './profile-career-preferences.component.html',
  styleUrl: './profile-career-preferences.component.scss',
})
export class ProfileCareerPreferencesComponent {
  @Input({ required: true }) profile!: UserProfile;
  @Input({ required: true }) careerStacks!: CareerStack[];
  @Input({ required: true }) experienceLevels!: ExperienceLevel[];
  @Input({ required: true }) targetTimelines!: string[];
  @Input({ required: true }) learningPreferences!: string[];
  @Input({ required: true }) isSavingCareer!: boolean;
  @Input({ required: true }) careerSuccess!: string;
  @Output() saveCareerProfileIntent = new EventEmitter<void>();
  saveCareerProfile(): void {
    this.saveCareerProfileIntent.emit();
  }
}
