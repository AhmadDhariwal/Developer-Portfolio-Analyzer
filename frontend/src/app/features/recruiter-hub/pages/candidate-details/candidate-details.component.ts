import { Component, OnInit } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

@Component({
  selector: 'app-recruiter-candidate-details',
  standalone: false,
  template: `
    <section class="hub-page">
      <app-recruiter-loader *ngIf="loading" label="Loading candidate profile..." />

      <div class="message message--error" *ngIf="error">{{ error }}</div>
      <div class="message message--success" *ngIf="notice">{{ notice }}</div>

      <ng-container *ngIf="!loading && candidate">
        <header class="profile-hero">
          <div class="profile-hero__identity">
            <div class="profile-hero__avatar">{{ initial }}</div>
            <div>
              <span class="profile-hero__kicker">Candidate profile</span>
              <h1>{{ candidate.name }}</h1>
              <p>{{ candidate.profileSummary || candidate.headline }}</p>
            </div>
          </div>
          <div class="profile-hero__actions">
            <button type="button" class="cta" (click)="analyze()">Run AI Summary</button>
            <button type="button" class="cta cta--ghost" (click)="shortlist()">Shortlist</button>
          </div>
        </header>

        <div class="score-grid">
          <app-recruiter-stat-card label="Overall Score" [value]="candidate.readinessScore || candidate.score || 0" />
          <app-recruiter-stat-card label="GitHub Score" [value]="candidate.githubScore || 0" />
          <app-recruiter-stat-card label="Resume Score" [value]="candidate.resumeScore || 0" />
          <app-recruiter-stat-card label="Consistency Score" [value]="candidate.consistencyScore || 0" />
          <app-recruiter-stat-card label="Growth Score" [value]="candidate.growthPotentialScore || 0" />
          <app-recruiter-stat-card label="Profile Complete" [value]="(candidate.profileCompleteness || 0) + '%'" />
        </div>

        <div class="detail-grid">
          <article class="glass-card">
            <h3>Profile Overview</h3>
            <div class="detail-list">
              <div><label>Primary Stack</label><strong>{{ candidate.stack || 'Generalist' }}</strong></div>
              <div><label>Experience</label><strong>{{ candidate.yearsOfExperience || 0 }} years</strong></div>
              <div><label>Location</label><strong>{{ candidate.location || 'Remote' }}</strong></div>
              <div><label>Availability</label><strong>{{ candidate.availability || 'Available' }}</strong></div>
            </div>
            <div class="link-row">
              <a *ngIf="candidate.githubUsername" [href]="'https://github.com/' + candidate.githubUsername" target="_blank" rel="noreferrer">GitHub</a>
              <a *ngIf="candidate.portfolio" [href]="candidate.portfolio" target="_blank" rel="noreferrer">Public Portfolio</a>
            </div>
          </article>

          <article class="glass-card">
            <h3>GitHub Statistics</h3>
            <div class="detail-list">
              <div><label>Public Repos</label><strong>{{ candidate.githubStats?.repos || 0 }}</strong></div>
              <div><label>Stars</label><strong>{{ candidate.githubStats?.stars || 0 }}</strong></div>
              <div><label>Forks</label><strong>{{ candidate.githubStats?.forks || 0 }}</strong></div>
              <div><label>Followers</label><strong>{{ candidate.githubStats?.followers || 0 }}</strong></div>
            </div>
          </article>

          <article class="glass-card">
            <h3>Skills</h3>
            <div class="tag-row">
              <span *ngFor="let skill of candidate.skills">{{ skill }}</span>
            </div>
            <div *ngIf="(candidate.skillGaps || []).length" class="sub-block">
              <h4>Skill Gaps</h4>
              <div class="tag-row tag-row--warn">
                <span *ngFor="let skill of candidate.skillGaps">{{ skill }}</span>
              </div>
            </div>
          </article>

          <article class="glass-card">
            <h3>Top Projects</h3>
            <div class="project-list" *ngIf="(candidate.projects || []).length; else noProjects">
              <div class="project-card" *ngFor="let project of candidate.projects">
                <strong>{{ project.title }}</strong>
                <p>{{ project.description || 'No project summary provided.' }}</p>
                <span>{{ (project.technologies || []).join(', ') }}</span>
              </div>
            </div>
            <ng-template #noProjects>
              <p class="muted">No public projects available yet.</p>
            </ng-template>
          </article>
        </div>

        <article class="glass-card" *ngIf="analysis || candidate.aiSummary">
          <h3>AI Summary</h3>
          <p>{{ analysis?.summary || candidate.aiSummary }}</p>
          <div class="detail-list" *ngIf="analysis">
            <div><label>Recommendation</label><strong>{{ analysis.recommendation }}</strong></div>
            <div><label>Confidence</label><strong>{{ analysis.confidenceScore || 0 }}</strong></div>
          </div>
        </article>
      </ng-container>
    </section>
  `,
  styles: [`
    .hub-page{display:flex;flex-direction:column;gap:1rem}
    .message{padding:.85rem 1rem;border-radius:14px;font-size:.88rem}
    .message--error{background:rgba(127,29,29,.45);border:1px solid rgba(248,113,113,.24);color:#fecaca}
    .message--success{background:rgba(6,78,59,.45);border:1px solid rgba(52,211,153,.2);color:#bbf7d0}
    .profile-hero{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;flex-wrap:wrap;padding:1.15rem;border-radius:24px;background:linear-gradient(135deg,rgba(17,24,39,.96),rgba(30,41,59,.88));border:1px solid rgba(99,102,241,.2);box-shadow:0 24px 48px rgba(2,6,23,.32)}
    .profile-hero__identity{display:flex;gap:1rem;align-items:flex-start;min-width:0}
    .profile-hero__avatar{width:60px;height:60px;border-radius:18px;background:linear-gradient(135deg,#7c3aed,#4f46e5);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.35rem;font-weight:800;flex-shrink:0}
    .profile-hero__kicker{display:inline-flex;margin-bottom:.45rem;padding:.32rem .68rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.72rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    h1{margin:0;color:#f8fafc;font-size:2rem}
    .profile-hero p{margin:.45rem 0 0;color:#94a3b8;max-width:720px}
    .profile-hero__actions{display:flex;gap:.7rem;flex-wrap:wrap}
    .cta{min-height:42px;border:none;border-radius:12px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-weight:700;cursor:pointer;padding:0 1rem}
    .cta--ghost{background:rgba(30,41,59,.92);color:#e2e8f0}
    .score-grid,.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:1rem}
    .glass-card{padding:1.05rem;border-radius:22px;background:linear-gradient(180deg,rgba(15,23,42,.94),rgba(15,23,42,.82));border:1px solid rgba(99,102,241,.16);box-shadow:0 24px 44px rgba(2,6,23,.28)}
    .glass-card h3,.glass-card h4{margin:0 0 .85rem;color:#f8fafc}
    .detail-list{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:.75rem}
    .detail-list div{padding:.8rem;border-radius:16px;background:rgba(15,23,42,.86);border:1px solid rgba(51,65,85,.72)}
    .detail-list label{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.08em;color:#94a3b8;margin-bottom:.35rem}
    .detail-list strong{color:#f8fafc}
    .link-row,.tag-row{display:flex;flex-wrap:wrap;gap:.55rem}
    .link-row a{padding:.42rem .72rem;border-radius:999px;background:rgba(59,130,246,.14);color:#bfdbfe;text-decoration:none}
    .tag-row span{padding:.28rem .58rem;border-radius:999px;background:rgba(79,70,229,.16);color:#c7d2fe;font-size:.74rem}
    .tag-row--warn span{background:rgba(248,113,113,.12);color:#fecaca}
    .sub-block{margin-top:.95rem}
    .project-list{display:grid;gap:.75rem}
    .project-card{padding:.85rem;border-radius:18px;background:rgba(15,23,42,.86);border:1px solid rgba(51,65,85,.72)}
    .project-card strong{color:#f8fafc}
    .project-card p{margin:.35rem 0;color:#cbd5e1;line-height:1.6}
    .project-card span,.muted{color:#94a3b8;font-size:.82rem}
  `]
})
export class CandidateDetailsComponent implements OnInit {
  loading = true;
  error = '';
  notice = '';
  candidate: any = null;
  analysis: any = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly candidateService: CandidateService,
    private readonly matchService: RecruiterMatchService
  ) {}

  get initial(): string {
    return String(this.candidate?.name || 'C').trim().charAt(0).toUpperCase() || 'C';
  }

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.candidateService.getCandidate(id).subscribe({
      next: (response) => {
        this.candidate = response?.candidate || null;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to load candidate details.';
        this.loading = false;
      }
    });
  }

  analyze(): void {
    const candidateId = this.getCandidateId();
    if (!candidateId) return;
    this.notice = '';
    this.error = '';
    this.candidateService.analyzeCandidate(candidateId).subscribe({
      next: (response) => {
        this.analysis = response?.analysis || null;
        this.notice = 'AI summary refreshed.';
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to analyze this candidate right now.';
      }
    });
  }

  shortlist(): void {
    const candidateId = this.getCandidateId();
    if (!candidateId) return;
    this.notice = '';
    this.error = '';
    this.matchService.addToShortlist({ candidateId }).subscribe({
      next: () => {
        this.notice = `${this.candidate?.name || 'Candidate'} added to shortlist.`;
      },
      error: (err) => {
        this.error = err?.error?.message || 'Unable to shortlist this candidate.';
      }
    });
  }

  private getCandidateId(): string {
    return String(this.candidate?.id || this.candidate?.userId || '').trim();
  }
}
