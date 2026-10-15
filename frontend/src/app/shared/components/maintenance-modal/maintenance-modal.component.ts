import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { UiModalComponent } from '../ui-modal/ui-modal.component';
import { UiButtonComponent } from '../ui-button/ui-button.component';
import { UiBadgeComponent } from '../ui-badge/ui-badge.component';

@Component({
  selector: 'app-maintenance-modal',
  standalone: true,
  imports: [CommonModule, UiModalComponent, UiButtonComponent, UiBadgeComponent],
  templateUrl: './maintenance-modal.component.html',
  styleUrl: './maintenance-modal.component.scss'
})
export class MaintenanceModalComponent {
  @Input() message = 'Application is under maintenance. Please go back to sign in and try again later.';
  @Output() close = new EventEmitter<void>();
}
