import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-recruiter-job-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './job-card.component.html',
  styleUrl: './job-card.component.scss',
})
export class JobCardComponent {
  @Input() job: any;
  @Input() hideActions = false;
  @Output() view = new EventEmitter<any>();
  @Output() edit = new EventEmitter<any>();
  @Output() archive = new EventEmitter<any>();
  @Output() remove = new EventEmitter<any>();

  get isClosed(): boolean {
    return String(this.job?.status || '').toLowerCase() === 'closed';
  }

  get visibleSkills(): string[] {
    return Array.isArray(this.job?.requiredSkills) ? this.job.requiredSkills.slice(0, 6) : [];
  }

  get extraSkillsCount(): number {
    const total = Array.isArray(this.job?.requiredSkills) ? this.job.requiredSkills.length : 0;
    return Math.max(0, total - 6);
  }

  get salaryLabel(): string {
    const min = Number(this.job?.salaryRangeMin || 0);
    const max = Number(this.job?.salaryRangeMax || 0);
    if (min <= 0 && max <= 0) return '';
    const fmt = (val: number) => `$${Math.round(val / 1000)}k`;
    if (min > 0 && max > 0) return `${fmt(min)} - ${fmt(max)}`;
    return min > 0 ? `From ${fmt(min)}` : `Up to ${fmt(max)}`;
  }
}
