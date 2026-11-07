import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { AppNotification } from '../../../../shared/services/notification.service';
import { NotificationPresentation } from '../../notification-presentation';
@Component({
  selector: 'app-notification-item',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './notification-item.component.html',
  styleUrl: './notification-item.component.scss',
})
export class NotificationItemComponent extends NotificationPresentation {
  @Input({ required: true }) notification!: AppNotification;
  @Input({ required: true }) selected!: boolean;
  @Output() readonly openRequested = new EventEmitter<AppNotification>();
  @Output() readonly markReadRequested = new EventEmitter<AppNotification>();
  @Output() readonly deleteRequested = new EventEmitter<AppNotification>();
  @Output() readonly selectionToggled = new EventEmitter<AppNotification>();
}
