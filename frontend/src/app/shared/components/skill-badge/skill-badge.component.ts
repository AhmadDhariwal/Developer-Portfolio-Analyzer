import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-skill-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './skill-badge.component.html',
  styleUrl: './skill-badge.component.scss'
})
export class SkillBadgeComponent {
  @Input() skill: string = '';
  @Input() category: string = '';

  get categoryColorClass(): string {
    const colorMap: { [key: string]: string } = {
      'Programming Languages': 'skill-blue',
      'Frameworks & Libraries': 'skill-purple',
      'Technologies & Tools': 'skill-green',
      'Soft Skills': 'skill-orange'
    };
    return colorMap[this.category] || 'skill-blue';
  }
}
