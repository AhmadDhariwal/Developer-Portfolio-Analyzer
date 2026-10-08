import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiBadgeComponent, BadgeVariant } from '../ui-badge/ui-badge.component';

@Component({
  selector: 'app-ui-section-header',
  standalone: true,
  imports: [CommonModule, UiBadgeComponent],
  templateUrl: './ui-section-header.component.html',
  styleUrl: './ui-section-header.component.scss'
})
export class UiSectionHeaderComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle?: string;
  @Input() badgeText?: string;
  @Input() badgeVariant: BadgeVariant = 'secondary';
}
