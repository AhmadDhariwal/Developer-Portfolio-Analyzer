import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export type AdminStatTone = 'indigo' | 'emerald' | 'sky' | 'amber' | 'slate' | 'rose';
export type AdminBadgeTone = 'neutral' | 'positive' | 'negative' | 'info';

@Component({
  selector: 'app-admin-stat-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './admin-stat-card.component.html',
  styleUrl: './admin-stat-card.component.scss',
})
export class AdminStatCardComponent {
  @Input() label = '';
  @Input() value: string | number | null | undefined = '';
  @Input() hint = '';
  @Input() badge = '';
  @Input() badgeTone: AdminBadgeTone = 'neutral';
  @Input() tone: AdminStatTone = 'indigo';
  @Input() interactive = false;

  @Output() cardClick = new EventEmitter<void>();

  get isUnavailable(): boolean {
    return String(this.value ?? '')
      .trim()
      .toLowerCase()
      .includes('unavailable');
  }

  onActivate(): void {
    if (this.interactive) {
      this.cardClick.emit();
    }
  }
}
