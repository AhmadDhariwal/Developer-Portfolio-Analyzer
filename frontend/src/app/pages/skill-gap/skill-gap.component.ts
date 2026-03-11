import { Component, OnInit } from '@angular/core';
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

@Component({
  selector: 'app-skill-gap',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './skill-gap.component.html',
  styleUrl: './skill-gap.component.scss',
})
export class SkillGapComponent implements OnInit {
  username = '';
  isLoading = false;
  isInitLoading = true;
  errorMessage = '';
  result: SkillGapResult | null = null;

  constructor(
    private readonly skillGapService: SkillGapService,
    private readonly githubService: GithubService,
  ) {}

  ngOnInit(): void {
    // Fetch the active GitHub username (from GitHub Analyzer / signup)
    this.isInitLoading = true;
    this.githubService.getActiveUsername().subscribe({
      next: (data) => {
        this.username = data.username;
        this.isInitLoading = false;
        // Auto-analyze with the active username
        if (this.username) {
          this.analyze();
        }
      },
      error: () => {
        this.isInitLoading = false;
      }
    });
  }

  analyze(): void {
    const user = this.username.trim();
    if (!user) return;

    this.isLoading = true;
    this.errorMessage = '';
    this.result = null;

    this.skillGapService.analyze(user).subscribe({
      next: (data) => {
        this.result = data;
        this.isLoading = false;
      },
      error: (err) => {
        this.errorMessage =
          err?.error?.message || 'Failed to analyze skill gap. Please try again.';
        this.isLoading = false;
      },
    });
  }

  /* ── Helpers ──────────────────────────────────────── */

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

  /** Coverage bar width clamped to [0, 100] */
  coverageWidth(pct: number): string {
    return `${Math.min(100, Math.max(0, pct))}%`;
  }

  /** Track-by helpers to avoid excessive re-renders */
  trackByName(_: number, item: CurrentSkill | MissingSkill): string {
    return item.name;
  }

  trackByPhase(_: number, item: RoadmapPhase): string {
    return item.phase;
  }
}
