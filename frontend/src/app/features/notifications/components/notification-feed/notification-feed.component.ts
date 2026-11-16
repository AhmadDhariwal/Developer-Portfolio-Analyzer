import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AppNotification } from '../../../../shared/services/notification.service';
import { NotificationPresentation } from '../../notification-presentation';
import { NotificationBulkActionsComponent } from '../notification-bulk-actions/notification-bulk-actions.component';
import { NotificationEmptyStateComponent } from '../notification-empty-state/notification-empty-state.component';
import { NotificationItemComponent } from '../notification-item/notification-item.component';
@Component({
  selector: 'app-notification-feed',
  standalone: true,
  imports: [
    CommonModule,
    NotificationBulkActionsComponent,
    NotificationItemComponent,
    NotificationEmptyStateComponent,
  ],
  templateUrl: './notification-feed.component.html',
  styleUrl: './notification-feed.component.scss',
})
export class NotificationFeedComponent extends NotificationPresentation {
  @Input({ required: true }) clearingAll!: boolean;
  @Input({ required: true }) loading!: boolean;
  @Input({ required: true }) selectedIds!: Set<string>;
  @Input({ required: true }) deletingSelected!: boolean;
  @Input({ required: true }) unreadCount!: number;
  @Input({ required: true }) total!: number;
  @Input({ required: true }) page!: number;
  @Input({ required: true }) totalPages!: number;
  @Input({ required: true }) notifications!: AppNotification[];
  @Input({ required: true }) loadFailed!: boolean;
  @Output() readonly deleteSelectedRequested = new EventEmitter<void>();
  @Output() readonly selectionCleared = new EventEmitter<void>();
  @Output() readonly pageRequested = new EventEmitter<number>();
  @Output() readonly retryRequested = new EventEmitter<void>();
  @Output() readonly openRequested = new EventEmitter<AppNotification>();
  @Output() readonly markReadRequested = new EventEmitter<AppNotification>();
  @Output() readonly deleteRequested = new EventEmitter<AppNotification>();
  @Output() readonly selectionToggled = new EventEmitter<AppNotification>();
}
