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
import { RoleService, TargetRole } from '../../shared/services/role.service';
import { Subscription } from 'rxjs';

type Tab = 'All' | 'Projects' | 'Technologies' | 'Career Paths';

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recommendations.component.html',
  styleUrl: './recommendations.component.scss',
})
export class RecommendationsComponent implements OnInit, OnDestroy {
  username   = '';
  selectedRole: TargetRole = 'Full Stack Developer';
  isLoading  = false;
  errorMessage = '';
  result: RecommendationsResult | null = null;
  private subscriptions: Subscription = new Subscription();

  activeTab: Tab = 'All';
  readonly tabs: Tab[] = ['All', 'Projects', 'Technologies', 'Career Paths'];

  constructor(
    private readonly recService: RecommendationsService,
    private readonly githubService: GithubService,
    private readonly roleService: RoleService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    // 1. Subscribe to Global Role
    this.subscriptions.add(
      this.roleService.targetRole$.subscribe(role => {
        this.selectedRole = role;
        if (this.username) this.analyze();
      })
    );

    // 2. Auto-load with the last-searched GitHub username
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

    this.recService.getRecommendations(user, this.selectedRole).subscribe({
      next: (data) => {
        const normalized: RecommendationsResult = {
          username: data?.username || user,
          projects: Array.isArray(data?.projects) ? data.projects : [],
          technologies: Array.isArray(data?.technologies) ? data.technologies : [],
          careerPaths: Array.isArray(data?.careerPaths) ? data.careerPaths : []
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

  setTab(tab: Tab): void { this.activeTab = tab; }

  showProjects():     boolean { return this.activeTab === 'All' || this.activeTab === 'Projects'; }
  showTechnologies(): boolean { return this.activeTab === 'All' || this.activeTab === 'Technologies'; }
  showCareerPaths():  boolean { return this.activeTab === 'All' || this.activeTab === 'Career Paths'; }

  /** CSS class for difficulty badge */
  getDifficultyClass(d: RecommendedProject['difficulty']): string {
    switch (d) {
      case 'Advanced':     return 'badge-advanced';
      case 'Intermediate': return 'badge-intermediate';
      default:             return 'badge-beginner';
    }
  }

  /** CSS class for technology priority badge */
  getPriorityClass(raw: RecommendedTechnology['priorityRaw']): string {
    switch (raw) {
      case 'High':   return 'priority-must';
      case 'Medium': return 'priority-high';
      default:       return 'priority-rec';
    }
  }

  /** CSS class for career match percentage */
  getMatchClass(match: number): string {
    if (match >= 75) return 'match-green';
    if (match >= 50) return 'match-purple';
    return 'match-blue';
  }

  /** Width string for progress bar */
  barWidth(pct: number): string {
    return `${Math.min(100, Math.max(0, pct))}%`;
  }

  /** Track-by helpers */
  trackById(_: number, item: RecommendedProject | CareerPath): string {
    return item.id;
  }
  trackByName(_: number, item: RecommendedTechnology): string {
    return item.name;
  }
}
