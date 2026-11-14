import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-notification-bulk-actions',
  standalone: true,
  templateUrl: './notification-bulk-actions.component.html',
  styleUrl: './notification-bulk-actions.component.scss',
})
export class NotificationBulkActionsComponent {
  @Input() selectedCount = 0;
  @Input() disabled = false;
  @Output() deleteRequested = new EventEmitter<void>();
  @Output() selectionCleared = new EventEmitter<void>();
}
