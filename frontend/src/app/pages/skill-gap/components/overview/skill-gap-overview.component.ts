import { Component, Input, ChangeDetectionStrategy, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SkillGapResult } from '../../../../shared/services/skill-gap.service';
import { warningLabel } from '../../skill-gap-presentation';

type SourceState = 'missing' | 'stale' | 'partial' | 'available' | 'unknown';
interface CoverageSummary {
  unavailable: boolean;
  totalRequiredCount: number;
  assessedRequiredCount: number;
  unknownRequiredCount: number;
  github: SourceState;
  resume: SourceState;
}
const ASSESSED_STATUSES = new Set(['DEMONSTRATED', 'PARTIAL', 'CLAIMED_ONLY', 'NOT_EVIDENCED']);

@Component({
  selector: 'section[skillGapOverview]',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './skill-gap-overview.component.html',
})
export class SkillGapOverviewComponent implements OnChanges {
  @Input({ required: true }) analysis!: SkillGapResult;
  @Input() evidenceBackedCount = 0;
  @Input() demonstratedCount = 0;
  @Input() partialCount = 0;
  @Input() validatedGapsCount = 0;
  @Input() claimedCount = 0;
  @Input() totalWeeks = '';
  @Input() roadmapPhaseCount = 0;
  readonly warningLabel = warningLabel;
  summary: CoverageSummary = {
    unavailable: true,
    totalRequiredCount: 0,
    assessedRequiredCount: 0,
    unknownRequiredCount: 0,
    github: 'unknown',
    resume: 'unknown',
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['analysis']) return;
    const required = this.analysis?.requiredSkills;
    const hasRequiredList = Array.isArray(required) && required.length > 0;
    const skills = hasRequiredList
      ? required
      : Array.isArray(this.analysis?.skills)
        ? this.analysis.skills
        : [];
    let total = 0;
    let unknown = 0;
    for (const skill of skills || []) {
      if (!hasRequiredList && skill.requirement !== 'REQUIRED') continue;
      total++;
      if (!ASSESSED_STATUSES.has(skill.status)) unknown++;
    }
    this.summary = {
      unavailable: this.analysis?.coverage == null,
      totalRequiredCount: total,
      assessedRequiredCount: total - unknown,
      unknownRequiredCount: unknown,
      github: this.sourceState('github'),
      resume: this.sourceState('resume'),
    };
  }

  private sourceState(type: 'github' | 'resume'): SourceState {
    const analysis = this.analysis;
    const source =
      analysis?.sourceReferences?.find((entry) => entry.type === type) ??
      analysis?.evidenceCompleteness?.sources?.find((entry) => entry.type === type);
    const available =
      source?.available ??
      (type === 'github'
        ? (analysis?.evidenceCompleteness?.githubAvailable ??
          analysis?.signalsUsed?.github?.connected)
        : (analysis?.evidenceCompleteness?.resumeAvailable ??
          analysis?.signalsUsed?.resume?.analyzed));
    if (available === false) return 'missing';
    if (source?.freshness === 'STALE' || analysis?.warnings?.includes(`stale_source:${type}`))
      return 'stale';
    if (available !== true) return 'unknown';
    return source?.completeness === 'PARTIAL' ? 'partial' : 'available';
  }
}
