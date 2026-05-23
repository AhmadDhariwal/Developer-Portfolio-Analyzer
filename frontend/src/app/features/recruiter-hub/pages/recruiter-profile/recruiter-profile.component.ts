import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../../../shared/services/auth.service';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-profile',
  standalone: false,
  templateUrl: './recruiter-profile.component.html',
  styleUrl: './recruiter-profile.component.css'
})
export class RecruiterProfileComponent implements OnInit {
  profile: any = null;
  error = '';
  notice = '';
  preferredStacks = '';
  preferredLocations = '';
  preferredJobTypes = '';
  noteTemplate = '';
  activityDigest = true;

  constructor(
    private readonly hubService: RecruiterHubService,
    private readonly authService: AuthService
  ) {}

  ngOnInit(): void {
    this.hubService.getProfile().subscribe({
      next: (response) => {
        this.profile = response?.profile || null;
        this.preferredStacks = (this.profile?.recruiterPreferences?.preferredStacks || []).join(', ');
        this.preferredLocations = (this.profile?.recruiterPreferences?.preferredLocations || []).join(', ');
        this.preferredJobTypes = (this.profile?.recruiterPreferences?.preferredJobTypes || []).join(', ');
        this.noteTemplate = this.profile?.recruiterPreferences?.noteTemplate || '';
        this.activityDigest = this.profile?.recruiterPreferences?.activityDigest !== false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load recruiter profile.';
      }
    });
  }

  save(): void {
    if (!this.profile) return;
    this.error = '';
    this.notice = '';

    const payload = {
      ...this.profile,
      recruiterPreferences: {
        preferredStacks: this.toArray(this.preferredStacks),
        preferredLocations: this.toArray(this.preferredLocations),
        preferredJobTypes: this.toArray(this.preferredJobTypes),
        noteTemplate: this.noteTemplate,
        activityDigest: this.activityDigest
      }
    };

    this.hubService.updateProfile(payload).subscribe({
      next: (response) => {
        this.profile = response?.profile || this.profile;
        this.authService.updateCurrentUser({
          name: this.profile?.name,
          avatar: this.profile?.avatar,
          githubUsername: this.profile?.githubUsername
        });
        this.notice = 'Recruiter profile updated successfully.';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to update recruiter profile.';
      }
    });
  }

  private toArray(value: string): string[] {
    return String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}
