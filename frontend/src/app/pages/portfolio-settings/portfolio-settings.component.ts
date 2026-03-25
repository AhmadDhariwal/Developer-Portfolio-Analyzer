import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PublicProfileService, PublicProfilePayload, PublicProfileSkill, PublicProfileAnalytics } from '../../shared/services/public-profile.service';

@Component({
  selector: 'app-portfolio-settings',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './portfolio-settings.component.html',
  styleUrl: './portfolio-settings.component.scss'
})
export class PortfolioSettingsComponent implements OnInit {
  profile: PublicProfilePayload | null = null;
  analytics: PublicProfileAnalytics | null = null;
  isLoading = true;
  isSaving = false;
  message = '';

  constructor(
    private readonly profileService: PublicProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.loadProfile();
  }

  loadProfile(): void {
    this.isLoading = true;
    this.profileService.getMyPublicProfile().subscribe({
      next: (profile) => {
        this.profile = profile;
        this.isLoading = false;
        this.loadAnalytics();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  loadAnalytics(): void {
    this.profileService.getAnalytics().subscribe({
      next: (analytics) => {
        this.analytics = analytics;
        this.cdr.detectChanges();
      },
      error: () => {
        this.cdr.detectChanges();
      }
    });
  }

  get shareUrl(): string {
    if (!this.profile) return '';
    return `${window.location.origin}/p/${this.profile.slug}`;
  }

  addSkill(): void {
    if (!this.profile) return;
    this.profile.skills = [...this.profile.skills, { name: 'New Skill', score: 60 }];
  }

  removeSkill(index: number): void {
    if (!this.profile) return;
    this.profile.skills.splice(index, 1);
  }

  saveProfile(): void {
    if (!this.profile) return;
    this.isSaving = true;
    this.message = '';

    const payload = {
      slug: this.profile.slug,
      isPublic: this.profile.isPublic,
      headline: this.profile.headline,
      summary: this.profile.summary,
      seoTitle: this.profile.seoTitle,
      seoDescription: this.profile.seoDescription,
      skills: this.profile.skills as PublicProfileSkill[],
      projects: this.profile.projects,
      socialLinks: this.profile.socialLinks
    };

    this.profileService.updateMyPublicProfile(payload).subscribe({
      next: (profile) => {
        this.profile = profile;
        this.isSaving = false;
        this.message = 'Profile updated successfully.';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isSaving = false;
        this.message = err?.error?.message || 'Failed to update profile.';
        this.cdr.detectChanges();
      }
    });
  }
}
