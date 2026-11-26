import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

export interface TimelineEvent {
  status: string;
  at: string;
}

const KNOWN_TONES = new Set(['submitted', 'reviewing', 'rejected', 'withdrawn']);

@Component({
  selector: 'app-application-timeline',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './application-timeline.component.html',
  styleUrl: './application-timeline.component.scss',
})
export class ApplicationTimelineComponent {
  @Input() timeline: TimelineEvent[] | null | undefined = [];

  get events(): TimelineEvent[] {
    return Array.isArray(this.timeline) ? this.timeline : [];
  }

  statusTone(status: string): string {
    const normalized = String(status || '')
      .trim()
      .toLowerCase();
    return KNOWN_TONES.has(normalized) ? normalized : 'neutral';
  }
}
