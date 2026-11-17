import { Component, EventEmitter, Input, Output } from '@angular/core';
import { NotificationPresentation } from '../../notification-presentation';

@Component({
  selector: 'app-notification-header',
  standalone: true,
  imports: [],
  templateUrl: './notification-header.component.html',
  styleUrl: './notification-header.component.scss',
})
export class NotificationHeaderComponent extends NotificationPresentation {
  @Input({ required: true }) readRate!: number;
  @Input({ required: true }) activeFiltersCount!: number;
  @Input({ required: true }) clearingAll!: boolean;
  @Input({ required: true }) deletingSelected!: boolean;
  @Input({ required: true }) total!: number;
  @Input({ required: true }) loading!: boolean;
  @Input({ required: true }) markingAllRead!: boolean;
  @Input({ required: true }) unreadCount!: number;
  @Output() readonly clearRequested = new EventEmitter<void>();
  @Output() readonly refreshRequested = new EventEmitter<void>();
  @Output() readonly markAllRequested = new EventEmitter<void>();
}
