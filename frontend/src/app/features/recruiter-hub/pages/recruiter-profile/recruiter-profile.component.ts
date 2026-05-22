import { Component, OnInit } from '@angular/core';
import { AuthService } from '../../../../shared/services/auth.service';
import { RecruiterHubService } from '../../services/recruiter-hub.service';

@Component({
  selector: 'app-recruiter-profile',
  standalone: false,
  template: `
    <section class="hub-page">
      <header class="hero">
        <div>
          <span class="hero__kicker">Profile Settings</span>
          <h1>Recruiter profile</h1>
          <p>Update recruiter identity, contact preferences, sourcing defaults, and profile metadata shown across the workspace.</p>
        </div>
      </header>

      <div class="message message--error" *ngIf="error">{{ error }}</div>
      <div class="message message--success" *ngIf="notice">{{ notice }}</div>

      <form class="glass-form" *ngIf="profile" (ngSubmit)="save()">
        <div class="field">
          <label>Name</label>
          <input [(ngModel)]="profile.name" name="name" placeholder="Recruiter name" />
        </div>
        <div class="field">
          <label>Email</label>
          <input [ngModel]="profile.email" name="email" disabled />
        </div>
        <div class="field">
          <label>Avatar URL</label>
          <input [(ngModel)]="profile.avatar" name="avatar" placeholder="https://..." />
        </div>
        <div class="field">
          <label>Job Title</label>
          <input [(ngModel)]="profile.jobTitle" name="jobTitle" placeholder="Senior Recruiter" />
        </div>
        <div class="field">
          <label>Location</label>
          <input [(ngModel)]="profile.location" name="location" placeholder="Karachi or Remote" />
        </div>
        <div class="field">
          <label>Phone</label>
          <input [(ngModel)]="profile.phoneNumber" name="phoneNumber" placeholder="+92 ..." />
        </div>
        <div class="field">
          <label>GitHub</label>
          <input [(ngModel)]="profile.githubUsername" name="githubUsername" placeholder="github username" />
        </div>
        <div class="field">
          <label>LinkedIn</label>
          <input [(ngModel)]="profile.linkedin" name="linkedin" placeholder="linkedin.com/in/..." />
        </div>
        <div class="field field--wide">
          <label>Bio</label>
          <textarea [(ngModel)]="profile.bio" name="bio" placeholder="Short recruiter bio"></textarea>
        </div>
        <div class="field">
          <label>Preferred Stacks</label>
          <input [(ngModel)]="preferredStacks" name="preferredStacks" placeholder="React, Node.js, Python" />
        </div>
        <div class="field">
          <label>Preferred Locations</label>
          <input [(ngModel)]="preferredLocations" name="preferredLocations" placeholder="Remote, Lahore, Karachi" />
        </div>
        <div class="field">
          <label>Preferred Job Types</label>
          <input [(ngModel)]="preferredJobTypes" name="preferredJobTypes" placeholder="Full-time, Contract" />
        </div>
        <div class="field field--wide">
          <label>Default note template</label>
          <textarea [(ngModel)]="noteTemplate" name="noteTemplate" placeholder="Quick outreach note template"></textarea>
        </div>
        <div class="toggle-row">
          <label>
            <input [(ngModel)]="activityDigest" name="activityDigest" type="checkbox" />
            Send recruiter activity digest
          </label>
        </div>
        <div class="form-actions">
          <button type="submit" class="primary-btn">Save Profile</button>
        </div>
      </form>
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .hero{padding:1.2rem;border-radius:24px;background:linear-gradient(135deg,rgba(17,24,39,.96),rgba(30,41,59,.88));border:1px solid rgba(99,102,241,.2);box-shadow:0 24px 48px rgba(2,6,23,.32)}
    .hero__kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .hero h1{margin:0;color:#f8fafc;font-size:2rem}
    .hero p{margin:.4rem 0 0;color:#94a3b8;max-width:760px}
    .message{padding:.85rem 1rem;border-radius:14px;font-size:.88rem}
    .message--error{background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .message--success{background:rgba(6,78,59,.45);border:1px solid rgba(52,211,153,.2);color:#bbf7d0}
    .glass-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:.9rem;padding:1rem 1.1rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .field{display:flex;flex-direction:column;gap:.4rem}
    .field--wide{grid-column:1/-1}
    label{font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
    input,textarea{width:100%;border-radius:12px;border:1px solid rgba(71,85,105,.75);background:rgba(15,23,42,.86);color:#f8fafc;padding:.78rem .9rem;outline:none}
    input[disabled]{opacity:.72}
    textarea{min-height:110px;resize:vertical}
    .toggle-row{grid-column:1/-1}
    .toggle-row label{display:flex;align-items:center;gap:.6rem;color:#e2e8f0;font-size:.88rem;letter-spacing:normal;text-transform:none}
    .form-actions{grid-column:1/-1;display:flex;justify-content:flex-end}
    .primary-btn{min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer;padding:0 1rem}
  `]
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
