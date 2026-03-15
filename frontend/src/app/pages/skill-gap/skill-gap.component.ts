import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  SkillGapService,
  SkillGapResult,
  CurrentSkill,
  MissingSkill,
  RoadmapPhase,
} from '../../shared/services/skill-gap.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

@Component({
  selector: 'app-skill-gap',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './skill-gap.component.html',
  styleUrl: './skill-gap.component.scss',
})
export class SkillGapComponent implements OnInit, OnDestroy {
  username = '';
  isLoading = false;
  isInitLoading = true;
  errorMessage = '';
  result: SkillGapResult | null = null;
  private subscriptions: Subscription = new Subscription();

  constructor(
    private readonly skillGapService:    SkillGapService,
    private readonly githubService:      GithubService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr:                ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // Subscribe to career profile changes — re-analyze whenever stack or level changes
    this.subscriptions.add(
      this.careerProfileService.careerProfile$.pipe(
        distinctUntilChanged((a, b) =>
          a.careerStack === b.careerStack && a.experienceLevel === b.experienceLevel
        )
      ).subscribe(() => {
        if (this.username) this.analyze();
      })
    );

    // Fetch the active GitHub username then trigger initial analysis
    this.isInitLoading = true;
    this.githubService.getActiveUsername().subscribe({
      next: (data) => {
        this.username = data.username;
        this.isInitLoading = false;
        if (this.username) this.analyze();
        this.cdr.detectChanges();
      },
      error: () => {
        this.isInitLoading = false;
        this.cdr.detectChanges();
      }
    });
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  analyze(): void {
    const user = this.username.trim();
    if (!user) return;

    this.isLoading = true;
    this.errorMessage = '';
    this.result = null;
    this.cdr.detectChanges();

    const { careerStack, experienceLevel } = this.careerProfileService.snapshot;

    this.skillGapService.analyze(user, careerStack, experienceLevel).subscribe({
      next: (data: any) => {
        const raw = data?.data || data?.result || data;

        const normalized: SkillGapResult = {
          username:        raw?.username        || user,
          careerStack:     raw?.careerStack     || careerStack,
          experienceLevel: raw?.experienceLevel || experienceLevel,
          coverage:        (typeof raw?.coverage === 'number') ? raw.coverage : 0,
          missing:         (typeof raw?.missing  === 'number') ? raw.missing  : 0,
          yourSkills:      Array.isArray(raw?.yourSkills)    ? raw.yourSkills    : [],
          missingSkills:   Array.isArray(raw?.missingSkills) ? raw.missingSkills : [],
          levelAssessment: raw?.levelAssessment || '',
          roadmap:         Array.isArray(raw?.roadmap) ? raw.roadmap : [],
          totalWeeks:      raw?.totalWeeks || 'N/A'
        };

        this.result = normalized;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to analyze skill gap. Please try again.';
        this.isLoading = false;
        this.result = null;
        this.cdr.detectChanges();
      }
    });
  }

  /* ── Helpers ──────────────────────────────────────────────────── */

  get currentCareerStack(): string  { return this.careerProfileService.careerStack; }
  get currentExperienceLevel(): string { return this.careerProfileService.experienceLevel; }

  getPriorityClass(priority: MissingSkill['priority']): string {
    switch (priority) {
      case 'High':   return 'badge-high';
      case 'Medium': return 'badge-medium';
      case 'Low':    return 'badge-low';
      default:       return '';
    }
  }

  getProficiencyClass(proficiency: number): string {
    if (proficiency >= 80) return 'bar-green';
    if (proficiency >= 60) return 'bar-blue';
    return 'bar-amber';
  }

  getPhaseClass(color: RoadmapPhase['color']): string {
    return `phase-${color}`;
  }

  coverageWidth(pct: number): string {
    return `${Math.min(100, Math.max(0, pct))}%`;
  }

  trackByName(_: number, item: CurrentSkill | MissingSkill): string {
    return item.name;
  }

  trackByPhase(_: number, item: RoadmapPhase): string {
    return item.phase;
  }
}
