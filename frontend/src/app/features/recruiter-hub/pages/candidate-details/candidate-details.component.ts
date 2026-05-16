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
      <ng-container *ngIf="!loading && candidate">
        <div class="hub-header"><h1>{{ candidate.name }}</h1><p>{{ candidate.profileSummary }}</p></div>
        <div class="detail-grid">
          <div class="glass-card">
            <h3>Profile Summary</h3>
            <p>{{ candidate.profileSummary }}</p>
            <p><strong>Stack:</strong> {{ candidate.stack }}</p>
            <p><strong>Experience:</strong> {{ candidate.yearsOfExperience }} years</p>
            <p><strong>Location:</strong> {{ candidate.location || 'Remote' }}</p>
            <p><strong>Portfolio:</strong> <a *ngIf="candidate.portfolio" [href]="candidate.portfolio" target="_blank" rel="noreferrer">Open public portfolio</a></p>
          </div>
          <div class="glass-card">
            <h3>Scores</h3>
            <p>Readiness {{ candidate.readinessScore }}</p>
            <p>GitHub {{ candidate.githubScore }}</p>
            <p>Resume {{ candidate.resumeScore }}</p>
            <p>Completeness {{ candidate.profileCompleteness }}%</p>
          </div>
          <div class="glass-card">
            <h3>Skills</h3>
            <div class="tag-row"><span *ngFor="let skill of candidate.skills">{{ skill }}</span></div>
            <h4>Skill Gaps</h4>
            <div class="tag-row"><span *ngFor="let skill of candidate.skillGaps">{{ skill }}</span></div>
          </div>
          <div class="glass-card">
            <h3>Projects</h3>
            <div *ngFor="let project of candidate.projects">
              <strong>{{ project.title }}</strong>
              <p>{{ project.description }}</p>
            </div>
          </div>
        </div>
        <div class="action-row">
          <button type="button" (click)="analyze()">Analyze Candidate</button>
          <button type="button" (click)="shortlist()">Shortlist</button>
        </div>
        <div class="glass-card" *ngIf="analysis">
          <h3>AI Candidate Summary</h3>
          <p>{{ analysis.summary }}</p>
          <p><strong>Recommendation:</strong> {{ analysis.recommendation }}</p>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`.hub-page{display:flex;flex-direction:column;gap:1rem}.hub-header h1{margin:0;color:#f8fafc}.hub-header p{margin:.35rem 0 0;color:#94a3b8}.detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem}.glass-card{padding:1rem;border-radius:16px;background:rgba(15,23,42,.82);border:1px solid rgba(51,65,85,.72);color:#e2e8f0}.glass-card h3,.glass-card h4{margin:0 0 .75rem;color:#f8fafc}.glass-card p{color:#cbd5e1}.tag-row{display:flex;flex-wrap:wrap;gap:.45rem}.tag-row span{padding:.25rem .55rem;border-radius:999px;background:rgba(30,41,59,.86)}.action-row{display:flex;gap:.75rem;flex-wrap:wrap}button{border:none;border-radius:10px;padding:.75rem 1rem;background:#6366f1;color:#fff;font-weight:700;cursor:pointer}`]
})
export class CandidateDetailsComponent implements OnInit {
  loading = true;
  candidate: any = null;
  analysis: any = null;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly candidateService: CandidateService,
    private readonly matchService: RecruiterMatchService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.candidateService.getCandidate(id).subscribe({
      next: (response) => {
        this.candidate = response?.candidate || null;
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      }
    });
  }

  analyze(): void {
    if (!this.candidate?.id) return;
    this.candidateService.analyzeCandidate(this.candidate.id).subscribe({
      next: (response) => {
        this.analysis = response?.analysis || null;
      }
    });
  }

  shortlist(): void {
    if (!this.candidate?.id) return;
    this.matchService.addToShortlist({ candidateId: this.candidate.id }).subscribe();
  }
}
