import { Component, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-job-details',
  standalone: false,
  template: `
    <section class="hub-page">
      <app-recruiter-loader *ngIf="loading" label="Loading job details..." />
      <div class="message message--error" *ngIf="error">{{ error }}</div>

      <ng-container *ngIf="!loading && job">
        <header class="hero">
          <div>
            <span class="hero__kicker">Job details</span>
            <h1>{{ job.title }}</h1>
            <p>{{ job.description }}</p>
          </div>
          <button type="button" class="cta" (click)="generateMatches()">Generate Match Results</button>
        </header>

        <div class="detail-grid">
          <article class="glass-card">
            <h3>Job Snapshot</h3>
            <div class="detail-list">
              <div><label>Status</label><strong>{{ job.status || 'open' }}</strong></div>
              <div><label>Stack</label><strong>{{ job.stack || 'Generalist' }}</strong></div>
              <div><label>Location</label><strong>{{ job.location || 'Remote' }}</strong></div>
              <div><label>Experience</label><strong>{{ job.minExperienceYears || 0 }}+ years</strong></div>
            </div>
          </article>

          <article class="glass-card">
            <h3>Required Skills</h3>
            <div class="tag-row">
              <span *ngFor="let skill of job.requiredSkills">{{ skill }}</span>
            </div>
          </article>

          <article class="glass-card">
            <h3>Preferred Skills</h3>
            <div class="tag-row">
              <span *ngFor="let skill of job.preferredSkills">{{ skill }}</span>
            </div>
          </article>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .message--error{padding:.85rem 1rem;border-radius:14px;background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .hero{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;padding:1.15rem;border-radius:24px;background:linear-gradient(135deg,rgba(17,24,39,.96),rgba(30,41,59,.88));border:1px solid rgba(99,102,241,.2);box-shadow:0 24px 48px rgba(2,6,23,.32)}
    .hero__kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{margin:0;color:#f8fafc;font-size:2rem}
    .hero p{margin:.45rem 0 0;color:#94a3b8;max-width:760px}
    .cta{min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer;padding:0 1rem}
    .detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}
    .glass-card{padding:1.05rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .glass-card h3{margin:0 0 .85rem;color:#f8fafc}
    .detail-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem}
    .detail-list div{padding:.8rem;border-radius:16px;background:rgba(15,23,42,.86);border:1px solid rgba(51,65,85,.72)}
    .detail-list label{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:.35rem}
    .detail-list strong{color:#f8fafc}
    .tag-row{display:flex;flex-wrap:wrap;gap:.55rem}
    .tag-row span{padding:.28rem .58rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.74rem}
  `]
})
export class JobDetailsComponent implements OnInit {
  loading = true;
  error = '';
  job: any = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly jobService: RecruiterJobService,
    private readonly matchService: RecruiterMatchService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.jobService.getJob(id).subscribe({
      next: (response) => {
        this.job = response?.job || null;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load this job.';
        this.loading = false;
      }
    });
  }

  generateMatches(): void {
    if (!this.job?._id) return;
    this.matchService.generateMatches({ jobId: this.job._id }).subscribe({
      next: () => {
        this.router.navigate(['/app/recruiter/matches'], { queryParams: { jobId: this.job._id } });
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to generate matches for this job.';
      }
    });
  }
}
