import { Component, OnInit } from '@angular/core';
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

type Tab = 'All' | 'Projects' | 'Technologies' | 'Career Paths';

@Component({
  selector: 'app-recommendations',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recommendations.component.html',
  styleUrl: './recommendations.component.scss',
})
export class RecommendationsComponent implements OnInit {
  username   = '';
  isLoading  = false;
  errorMessage = '';
  result: RecommendationsResult | null = null;

  activeTab: Tab = 'All';
  readonly tabs: Tab[] = ['All', 'Projects', 'Technologies', 'Career Paths'];

  constructor(
    private readonly recService: RecommendationsService,
    private readonly githubService: GithubService
  ) {}

  ngOnInit(): void {
    // Auto-load with the last-searched GitHub username, same as Skill Gap
    this.githubService.getActiveUsername().subscribe({
      next: (res: { username: string; isDefault?: boolean } | null) => {
        if (res?.username) {
          this.username = res.username;
          this.analyze();
        }
      },
      error: () => { /* No saved username yet — user can type manually */ }
    });
  }

  analyze(): void {
    const user = this.username.trim();
    if (!user) return;

    this.isLoading   = true;
    this.errorMessage = '';
    this.result      = null;

    this.recService.getRecommendations(user).subscribe({
      next: (data) => {
        this.result    = data;
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage =
          err?.error?.message || 'Failed to fetch recommendations. Please try again.';
        this.isLoading = false;
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
