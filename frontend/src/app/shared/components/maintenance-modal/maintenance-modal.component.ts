import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-maintenance-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './maintenance-modal.component.html',
  styleUrl: './maintenance-modal.component.scss'
})
export class MaintenanceModalComponent {
  @Input() message = 'Application is under maintenance. Please go back to sign in and try again later.';
  @Output() close = new EventEmitter<void>();
}
