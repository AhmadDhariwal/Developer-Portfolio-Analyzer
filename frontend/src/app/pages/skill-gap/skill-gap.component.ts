import { Component, OnInit, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  SkillGapService,
  SkillGapResult,
  CurrentSkill,
  MissingSkill,
  RoadmapPhase,
  SkillGraphNode,
  SkillGraphEdge,
  WeeklyRoadmapWeek
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
  graphLayout: Array<SkillGraphNode & { x: number; y: number }> = [];
  graphEdges: SkillGraphEdge[] = [];
  private readonly subscriptions: Subscription = new Subscription();

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
          skillGraph:      raw?.skillGraph?.nodes && raw?.skillGraph?.edges
            ? raw.skillGraph
            : { nodes: [], edges: [] },
          weeklyRoadmap:   Array.isArray(raw?.weeklyRoadmap) ? raw.weeklyRoadmap : [],
          totalWeeks:      raw?.totalWeeks || 'N/A'
        };

        const yourCount = Array.isArray(normalized.yourSkills) ? normalized.yourSkills.length : 0;
        const missingCount = Array.isArray(normalized.missingSkills) ? normalized.missingSkills.length : 0;
        const denom = yourCount + missingCount;
        const derivedCoverage = denom > 0 ? Math.round((yourCount / denom) * 100) : 0;

        const validCoverage = Number.isFinite(Number(normalized.coverage))
          ? Math.max(0, Math.min(100, Math.round(Number(normalized.coverage))))
          : derivedCoverage;

        normalized.coverage = validCoverage;
        normalized.missing = Math.max(0, Math.min(100, 100 - validCoverage));

        this.result = normalized;
        this.refreshGraphLayout();
        this.isLoading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to analyze skill gap. Please try again.';
        this.isLoading = false;
        this.result = null;
        this.graphLayout = [];
        this.graphEdges = [];
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

  getResourceTitle(resource: { title?: string; url?: string } | string): string {
    if (typeof resource === 'string') return resource;
    return String(resource?.title || 'Open resource');
  }

  getResourceUrl(resource: { title?: string; url?: string } | string): string {
    if (typeof resource === 'string') {
      return /^https?:\/\//i.test(resource)
        ? resource
        : `https://www.google.com/search?q=${encodeURIComponent(resource)}`;
    }
    const url = String(resource?.url || '').trim();
    if (/^https?:\/\//i.test(url)) return url;
    return `https://www.google.com/search?q=${encodeURIComponent(this.getResourceTitle(resource))}`;
  }

  trackByName(_: number, item: CurrentSkill | MissingSkill): string {
    return item.name;
  }

  trackByPhase(_: number, item: RoadmapPhase): string {
    return item.phase;
  }

  trackByWeek(_: number, item: WeeklyRoadmapWeek): number {
    return item.week;
  }

  private refreshGraphLayout(): void {
    const nodes = this.result?.skillGraph?.nodes || [];
    const edges = this.result?.skillGraph?.edges || [];
    const limitedNodes = nodes.slice(0, 16);

    const currentNodes = limitedNodes.filter((n) => n.kind === 'current');
    const missingNodes = limitedNodes.filter((n) => n.kind === 'missing');
    const allRows = Math.max(currentNodes.length, missingNodes.length, 1);

    const placeNodes = (
      list: SkillGraphNode[],
      x: number
    ): Array<SkillGraphNode & { x: number; y: number }> => {
      const step = 100 / (Math.max(list.length, 1) + 1);
      return list.map((node, index) => ({
        ...node,
        x,
        y: Math.round((index + 1) * step)
      }));
    };

    const left = placeNodes(currentNodes, 22);
    const right = placeNodes(missingNodes, 78);
    const fallbackCenter = limitedNodes.length && (!left.length || !right.length)
      ? limitedNodes.map((node, index) => ({
          ...node,
          x: 50 + (node.kind === 'current' ? -22 : 22),
          y: Math.round(((index % allRows) + 1) * (100 / (allRows + 1)))
        }))
      : [];

    this.graphLayout = left.length && right.length ? [...left, ...right] : fallbackCenter;
    const visibleIds = new Set(this.graphLayout.map((node) => node.id));
    this.graphEdges = edges.filter((edge) => visibleIds.has(edge.from) && visibleIds.has(edge.to));
  }

  findNode(id: string): (SkillGraphNode & { x: number; y: number }) | undefined {
    return this.graphLayout.find((node) => node.id === id);
  }
}
