import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  RecommendationsService,
  RecommendationsResult,
  RecommendedProject,
  RecommendedTechnology,
  CareerPath,
} from '../../shared/services/recommendations.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { Subscription } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';

type Tab = 'All' | 'Projects' | 'Technologies' | 'Career Paths';

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recommendations.component.html',
  styleUrl: './recommendations.component.scss',
})
export class RecommendationsComponent implements OnInit, OnDestroy {
  username     = '';
  isLoading    = false;
  errorMessage = '';
  result: RecommendationsResult | null = null;
  private subscriptions: Subscription = new Subscription();

  activeTab: Tab = 'All';
  readonly tabs: Tab[] = ['All', 'Projects', 'Technologies', 'Career Paths'];

  constructor(
    private readonly recService:           RecommendationsService,
    private readonly githubService:        GithubService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr:                  ChangeDetectorRef
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

    // Auto-load with the last-searched GitHub username
    this.githubService.getActiveUsername().subscribe({
      next: (res: { username: string; isDefault?: boolean } | null) => {
        if (res?.username) {
          this.username = res.username;
          this.analyze();
        }
        this.cdr.detectChanges();
      },
      error: () => {
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

    this.recService.getRecommendations(user, careerStack, experienceLevel).subscribe({
      next: (data) => {
        const normalized: RecommendationsResult = {
          username:        data?.username        || user,
          careerStack:     data?.careerStack     || careerStack,
          experienceLevel: data?.experienceLevel || experienceLevel,
          projects:        Array.isArray(data?.projects)     ? data.projects     : [],
          technologies:    Array.isArray(data?.technologies) ? data.technologies : [],
          careerPaths:     Array.isArray(data?.careerPaths)  ? data.careerPaths  : []
        };

        this.result = normalized;
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage =
          err?.error?.message || 'Failed to fetch recommendations. Please try again.';
        this.isLoading = false;
        this.result = null;
        this.cdr.detectChanges();
      },
    });
  }

  /* ── Helpers ────────────────────────────────────────────── */

  get currentCareerStack(): string    { return this.careerProfileService.careerStack; }
  get currentExperienceLevel(): string { return this.careerProfileService.experienceLevel; }

  setTab(tab: Tab): void { this.activeTab = tab; }

  showProjects():     boolean { return this.activeTab === 'All' || this.activeTab === 'Projects'; }
  showTechnologies(): boolean { return this.activeTab === 'All' || this.activeTab === 'Technologies'; }
  showCareerPaths():  boolean { return this.activeTab === 'All' || this.activeTab === 'Career Paths'; }

  getDifficultyClass(d: RecommendedProject['difficulty']): string {
    switch (d) {
      case 'Advanced':     return 'badge-advanced';
      case 'Intermediate': return 'badge-intermediate';
      default:             return 'badge-beginner';
    }
  }

  getPriorityClass(raw: RecommendedTechnology['priorityRaw']): string {
    switch (raw) {
      case 'High':   return 'priority-must';
      case 'Medium': return 'priority-high';
      default:       return 'priority-rec';
    }
  }

  getMatchClass(match: number): string {
    if (match >= 75) return 'match-green';
    if (match >= 50) return 'match-purple';
    return 'match-blue';
  }

  barWidth(pct: number): string {
    return `${Math.min(100, Math.max(0, pct))}%`;
  }

  trackById(_: number, item: RecommendedProject | CareerPath): string {
    return item.id;
  }

  trackByName(_: number, item: RecommendedTechnology): string {
    return item.name;
  }
}
