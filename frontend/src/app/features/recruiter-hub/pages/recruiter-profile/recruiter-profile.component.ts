import { Component, OnInit } from '@angular/core';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-profile',
  standalone: false,
  template: `
    <section class="hub-page">
      <div class="hub-header"><h1>Recruiter Profile</h1><p>Manage recruiter profile and workspace preferences.</p></div>
      <form class="glass-form" *ngIf="profile" (ngSubmit)="save()">
        <input [(ngModel)]="profile.name" name="name" placeholder="Name" />
        <input [(ngModel)]="profile.jobTitle" name="jobTitle" placeholder="Job title" />
        <input [(ngModel)]="profile.location" name="location" placeholder="Location" />
        <input [(ngModel)]="profile.githubUsername" name="githubUsername" placeholder="GitHub username" />
        <input [(ngModel)]="profile.linkedin" name="linkedin" placeholder="LinkedIn profile" />
        <textarea [(ngModel)]="profile.bio" name="bio" placeholder="Bio"></textarea>
        <textarea [(ngModel)]="preferredStacks" name="preferredStacks" placeholder="Preferred stacks"></textarea>
        <textarea [(ngModel)]="preferredLocations" name="preferredLocations" placeholder="Preferred locations"></textarea>
        <button type="submit">Save Profile</button>
      </form>
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.glass-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.75rem;padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72)}input,textarea{width:100%;border-radius:10px;border:1px solid rgba(51,65,85,.8);background:rgba(15,23,42,.65);color:#f8fafc;padding:.75rem .85rem}textarea{min-height:110px}button{grid-column:1/-1;border:none;border-radius:10px;padding:.8rem 1rem;background:#6366f1;color:#fff;font-weight:700;cursor:pointer}`]
})
export class RecruiterProfileComponent implements OnInit {
  profile: any = null;
  preferredStacks = '';
  preferredLocations = '';

  constructor(private readonly hubService: RecruiterHubService) {}

  ngOnInit(): void {
    this.hubService.getProfile().subscribe({
      next: (response) => {
        this.profile = response?.profile || null;
        this.preferredStacks = (this.profile?.recruiterPreferences?.preferredStacks || []).join(', ');
        this.preferredLocations = (this.profile?.recruiterPreferences?.preferredLocations || []).join(', ');
      }
    });
  }

  save(): void {
    if (!this.profile) return;
    this.hubService.updateProfile({
      ...this.profile,
      recruiterPreferences: {
        ...(this.profile.recruiterPreferences || {}),
        preferredStacks: this.preferredStacks.split(',').map((item) => item.trim()).filter(Boolean),
        preferredLocations: this.preferredLocations.split(',').map((item) => item.trim()).filter(Boolean)
      }
    }).subscribe();
  }
}
