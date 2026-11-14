import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { BadgeVariant, UiBadgeComponent, UiDrawerComponent } from '../../../../shared/components';
import { GitHubAnalysisResult, TechnologySignal } from '../../../../shared/services/github.service';
import { GithubPresentation } from '../../github-presentation';
import { DisplayBreakdownItem } from '../../github-view.models';

const AUDIT_INPUT_LABELS: Record<string, string> = {
  codeQuality: 'Code Quality',
  projectDiversity: 'Project Diversity',
  contribution: 'Commit Contribution',
  consistency: 'Update Consistency',
  projectImpact: 'Project Impact',
  profileStrength: 'Profile Strength',
};

const ACTIVITY_SCOPE_LABELS: Record<string, string> = {
  repository_contributor_history: 'Sampled repository contributor history',
  complete: 'Complete repository history',
  sampled: 'Sampled repository history',
};

const SOURCE_TYPE_LABELS: Record<string, string> = {
  'github-user': 'GitHub User',
  'github-repo': 'Repository',
  'github-cache': 'Cache Snapshot',
};

const AUDIT_NOTICE_MESSAGES: Record<string, string> = {
  activity_partial_or_unavailable:
    'Commit activity for one or more repositories was partial or unavailable during this run.',
  repository_metrics_partial:
    'Some repository star or fork metrics were incomplete; affected scoring dimensions remain marked unavailable.',
  language_data_unavailable:
    'Programming language byte distribution was unavailable for some repositories.',
  activity_sampled_repository_history:
    'Commit counts are sampled from contributor history across the evaluated repositories.',
  repository_quality_uses_sampled_signals:
    'Repository quality signals evaluate sampled README and metadata indicators.',
};

@Component({
  selector: 'app-github-technical-audit',
  standalone: true,
  imports: [CommonModule, UiDrawerComponent, UiBadgeComponent],
  templateUrl: './github-technical-audit.component.html',
  styleUrl: './github-technical-audit.component.scss',
})
export class GithubTechnicalAuditComponent extends GithubPresentation {
  @Input({ required: true }) showEvidenceDrawer!: boolean;
  @Input({ required: true }) result!: GitHubAnalysisResult | null;
  @Input({ required: true }) ruleVersion!: string;
  @Input({ required: true }) calculationTimestamp!: string;
  @Input({ required: true }) cacheStatusLabel!: string;
  @Input({ required: true }) originalRepoCount!: number;
  @Input({ required: true }) forkedRepoCount!: number;
  @Input({ required: true }) archivedRepoCount!: number;
  @Input({ required: true }) totalSampledCommits!: number | null;
  @Input({ required: true }) evidenceFacts!:
    | {
        repoCount?: number;
        originalRepoCount?: number;
        forkRepoCount?: number;
        archivedRepoCount?: number;
        languageCount?: number;
        totalStars?: number | null;
        totalForks?: number | null;
        totalCommits?: number | null;
        activeRepos?: number;
      }
    | null
    | undefined;
  @Input({ required: true }) scoreBreakdownList!: DisplayBreakdownItem[];
  @Input({ required: true }) hasTechnologyData!: boolean;
  @Input({ required: true }) technologyCategories!: {
    category: string;
    items: TechnologySignal[];
  }[];
  @Input({ required: true }) scoringWarnings!: string[];
  @Output() readonly closed = new EventEmitter<void>();

  /** Deterministic overall score from scoring output without fabricating unavailable scores. */
  get overallAuditScore(): number | null {
    if (this.result?.scoring?.score !== undefined) {
      return this.result.scoring.score;
    }
    if (this.result?.githubHealthScore !== undefined) {
      return this.result.githubHealthScore;
    }
    return null;
  }

  /** Converts camelCase or snake_case input identifiers into readable labels. */
  formatAuditInputLabel(key: string): string {
    if (AUDIT_INPUT_LABELS[key]) {
      return AUDIT_INPUT_LABELS[key];
    }
    const spaced = key
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .trim();
    return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
  }

  /** Formats numeric audit metrics while preserving measured zero distinctly from unavailable. */
  formatAuditScoreValue(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return 'Unavailable';
    }
    const numeric = Number(value);
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
  }

  /** Maps backend activity scope identifiers to clear descriptive labels. */
  formatActivityScope(scope?: string | null): string {
    if (!scope) {
      return ACTIVITY_SCOPE_LABELS['repository_contributor_history'];
    }
    if (ACTIVITY_SCOPE_LABELS[scope]) {
      return ACTIVITY_SCOPE_LABELS[scope];
    }
    const normalized = scope.replace(/[_-]+/g, ' ').trim();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  }

  /** Formats source type tags into readable badges. */
  formatSourceType(type?: string | null): string {
    if (!type) return 'Source';
    if (SOURCE_TYPE_LABELS[type]) {
      return SOURCE_TYPE_LABELS[type];
    }
    return type
      .split(/[-_]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  /** Translates backend snake_case notice identifiers into readable explanations. */
  formatAuditNotice(notice: string): string {
    if (AUDIT_NOTICE_MESSAGES[notice]) {
      return AUDIT_NOTICE_MESSAGES[notice];
    }
    if (!notice.includes('_')) {
      return notice;
    }
    const normalized = notice.replace(/_/g, ' ').trim();
    return normalized.charAt(0).toUpperCase() + normalized.slice(1) + '.';
  }

  /** Selects semantic badge tone for detected technology confidence levels. */
  getConfidenceVariant(confidence: number): BadgeVariant {
    if (confidence >= 75) return 'success';
    if (confidence >= 40) return 'primary';
    return 'neutral';
  }

  /** Bounds progress track fill percentage cleanly between 0 and 100. */
  getItemBarWidth(value: number | null): number {
    if (value === null || value === undefined || Number.isNaN(Number(value))) {
      return 0;
    }
    return Math.max(0, Math.min(100, Number(value)));
  }
}
