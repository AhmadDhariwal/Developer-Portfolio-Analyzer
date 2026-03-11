import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-suggestion-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './suggestion-card.component.html',
  styleUrl: './suggestion-card.component.scss'
})
export class SuggestionCardComponent {
  @Input() title: string = '';
  @Input() description: string = '';
  @Input() color: 'red' | 'orange' | 'blue' | 'purple' | 'cyan' = 'blue';
  @Input() icon: string = '';

  get iconMap(): { [key: string]: string } {
    return {
      red: '⚠️',
      orange: '⚡',
      blue: '💻',
      purple: '⭐',
      cyan: '✓'
    };
  }

  get displayIcon(): string {
    return this.icon || this.iconMap[this.color] || '💡';
  }

  get colorClass(): string {
    return `suggestion-${this.color}`;
  }
}
