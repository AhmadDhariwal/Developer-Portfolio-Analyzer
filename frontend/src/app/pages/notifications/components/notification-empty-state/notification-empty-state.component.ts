import { Component } from '@angular/core';
import { NotificationPresentation } from '../../notification-presentation';

@Component({
  selector: 'app-notification-empty-state',
  standalone: true,
  imports: [],
  templateUrl: './notification-empty-state.component.html',
  styleUrl: './notification-empty-state.component.scss',
})
export class NotificationEmptyStateComponent extends NotificationPresentation {}
