import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-activity-timeline',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './activity-timeline.component.html',
  styleUrl: './activity-timeline.component.scss',
})
export class ActivityTimelineComponent {
  @Input() items: any[] = [];

  labelFor(action: string): string {
    const value = String(action || '')
      .replace(/RECRUITER_/g, '')
      .replaceAll('_', ' ')
      .trim();
    if (!value) return 'Activity';
    return value.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
  }

  toneFor(action: string): 'ai' | 'shortlist' | 'job' | 'default' {
    const upper = String(action || '').toUpperCase();
    if (/ANALYZED|MATCH/.test(upper)) return 'ai';
    if (upper.includes('SHORTLIST')) return 'shortlist';
    if (upper.includes('JOB')) return 'job';
    return 'default';
  }

  candidateId(item: any): string {
    return String(item?.candidate?.id || item?.candidate?.userId || '').trim();
  }

  jobId(item: any): string {
    return String(item?.job?._id || '').trim();
  }

  trackByItem(index: number, item: any): string {
    return String(item?._id || item?.id || item?.timestamp || index);
  }
}
