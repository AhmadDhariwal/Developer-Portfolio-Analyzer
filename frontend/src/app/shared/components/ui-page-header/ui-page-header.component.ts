import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { UiBadgeComponent, BadgeVariant } from '../ui-badge/ui-badge.component';
import { UiIconButtonComponent } from '../ui-icon-button/ui-icon-button.component';

@Component({
  selector: 'app-ui-page-header',
  standalone: true,
  imports: [CommonModule, UiBadgeComponent, UiIconButtonComponent],
  templateUrl: './ui-page-header.component.html',
  styleUrl: './ui-page-header.component.scss'
})
export class UiPageHeaderComponent {
  @Input({ required: true }) title!: string;
  @Input() subtitle?: string;
  @Input() badgeText?: string;
  @Input() badgeVariant: BadgeVariant = 'primary';
  @Input() showBack: boolean = false;
  @Input() backLabel: string = 'Back';

  @Output() backClicked = new EventEmitter<void>();

  onBack(): void {
    this.backClicked.emit();
  }
}
