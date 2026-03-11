import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type BadgeVariant = 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'app-ui-badge',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './ui-badge.component.html',
  styleUrl: './ui-badge.component.scss'
})
export class UiBadgeComponent {
  @Input() variant: BadgeVariant = 'primary';
  @Input() size: BadgeSize = 'md';
  @Input() outlined: boolean = false;
}
