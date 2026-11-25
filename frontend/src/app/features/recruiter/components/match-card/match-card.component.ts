import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink } from '@angular/router';

interface BreakdownRow {
  key: string;
  label: string;
  weightPercent: number;
  raw: number | null;
  weighted: number | null;
}

@Component({
  selector: 'app-match-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './match-card.component.html',
  styleUrl: './match-card.component.scss',
})
export class MatchCardComponent {
  @Input() match: any;
  @Input() hideActions = false;
  @Input() selected = false;
  @Output() shortlist = new EventEmitter<any>();
  @Output() compare = new EventEmitter<any>();
  @Output() reject = new EventEmitter<any>();
  @Output() reset = new EventEmitter<any>();

  readonly ringRadius = 26;
  readonly ringCircumference = 2 * Math.PI * this.ringRadius;

  get isShortlisted(): boolean {
    return String(this.match?.status || '').toLowerCase() === 'shortlisted';
  }

  get isRejected(): boolean {
    return String(this.match?.status || '').toLowerCase() === 'rejected';
  }

  get candidateRouteId(): string {
    return String(
      this.match?.candidate?.id || this.match?.candidate?.userId || this.match?.candidateId || '',
    ).trim();
  }

  get jobRouteId(): string {
    return String(this.match?.job?._id || this.match?.jobId || '').trim();
  }

  get scoreValue(): number {
    const score = Number(this.match?.matchScore ?? 0);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  }

  get ringDashOffset(): number {
    return this.ringCircumference - (this.scoreValue / 100) * this.ringCircumference;
  }

  get scoreTone(): 'high' | 'mid' | 'low' {
    if (this.scoreValue >= 80) return 'high';
    if (this.scoreValue >= 60) return 'mid';
    return 'low';
  }

  get matchedSkills(): string[] {
    return Array.isArray(this.match?.breakdown?.matchedSkills)
      ? this.match.breakdown.matchedSkills.slice(0, 6)
      : [];
  }

  get breakdownRows(): BreakdownRow[] {
    const breakdown = this.match?.breakdown;
    if (!breakdown || typeof breakdown !== 'object') return [];
    const specs: Array<{ key: string; label: string; defaultWeight: number }> = [
      { key: 'skillMatch', label: 'Skill Match', defaultWeight: 30 },
      { key: 'projectQuality', label: 'Project Quality', defaultWeight: 20 },
      { key: 'github', label: 'GitHub', defaultWeight: 15 },
      { key: 'experience', label: 'Experience', defaultWeight: 15 },
      { key: 'consistency', label: 'Consistency', defaultWeight: 10 },
      { key: 'growth', label: 'Growth', defaultWeight: 10 },
    ];
    return specs.map((spec) => {
      const entry = breakdown[spec.key];
      const raw =
        entry?.raw === null || entry?.raw === undefined || !Number.isFinite(Number(entry.raw))
          ? null
          : Math.round(Number(entry.raw));
      const weighted =
        entry?.weighted === null ||
        entry?.weighted === undefined ||
        !Number.isFinite(Number(entry.weighted))
          ? null
          : Math.round(Number(entry.weighted) * 10) / 10;
      const weightPercent = entry?.weight ? Math.round(Number(entry.weight) * 100) : spec.defaultWeight;
      return { key: spec.key, label: spec.label, weightPercent, raw, weighted };
    });
  }
}
