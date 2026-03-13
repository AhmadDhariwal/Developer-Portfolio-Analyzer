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
import { RoleService, TargetRole } from '../../shared/services/role.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-skill-gap',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './skill-gap.component.html',
  styleUrl: './skill-gap.component.scss',
})
export class SkillGapComponent implements OnInit, OnDestroy {
  username = '';
  selectedRole: TargetRole = 'Full Stack Developer';
  isLoading = false;
  isInitLoading = true;
  errorMessage = '';
  result: SkillGapResult | null = null;
  private subscriptions: Subscription = new Subscription();

  constructor(
  private readonly skillGapService: SkillGapService,
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

    // 2. Fetch the active GitHub username
    this.isInitLoading = true;
    this.githubService.getActiveUsername().subscribe({
      next: (data) => {
        this.username = data.username;
        this.isInitLoading = false;
        if (this.username) {
          this.analyze();
        }
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

    this.skillGapService.analyze(user, this.selectedRole).subscribe({
      next: (data: any) => {
        console.log('SkillGap API response:', data);

        // Handle potential nesting or direct assignment
        // Sometimes APIs wrap response in { data: ... } or { result: ... }
        const raw = data?.data || data?.result || data;

        const normalized: SkillGapResult = {
          username: raw?.username || user,
          coverage: (typeof raw?.coverage === 'number') ? raw.coverage : 0,
          missing: (typeof raw?.missing === 'number') ? raw.missing : 0,
          yourSkills: Array.isArray(raw?.yourSkills) ? raw.yourSkills : [],
          missingSkills: Array.isArray(raw?.missingSkills) ? raw.missingSkills : [],
          roadmap: Array.isArray(raw?.roadmap) ? raw.roadmap : [],
          totalWeeks: raw?.totalWeeks || 'N/A'
        };

        console.log('Normalized SkillGap result:', normalized);
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
