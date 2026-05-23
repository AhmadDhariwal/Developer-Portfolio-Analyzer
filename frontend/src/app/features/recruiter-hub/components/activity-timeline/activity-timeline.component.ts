import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-activity-timeline',
  standalone: true,
  imports: [CommonModule],
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
}
