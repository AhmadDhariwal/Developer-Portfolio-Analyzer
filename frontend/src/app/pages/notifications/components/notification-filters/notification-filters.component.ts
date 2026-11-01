import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NotificationPresentation } from '../../notification-presentation';
import { OrganizationItem, TeamItem } from '../../notification-view.models';
@Component({
  selector: 'app-notification-filters',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './notification-filters.component.html',
  styleUrl: './notification-filters.component.scss',
})
export class NotificationFiltersComponent extends NotificationPresentation {
  @Input({ required: true }) clearingAll!: boolean;
  @Input({ required: true }) search!: string;
  @Input({ required: true }) from!: string;
  @Input({ required: true }) to!: string;
  @Input({ required: true }) override typeFilter = '';
  @Input({ required: true }) typeOptions!: { value: string; label: string }[];
  @Input({ required: true }) selectedOrganizationId!: string;
  @Input({ required: true }) organizations!: OrganizationItem[];
  @Input({ required: true }) teams!: TeamItem[];
  @Input({ required: true }) selectedTeamId!: string;
  @Input({ required: true }) override unreadOnly = false;
  @Output() readonly applyRequested = new EventEmitter<void>();
  @Output() readonly resetRequested = new EventEmitter<void>();
  @Output() readonly organizationChanged = new EventEmitter<void>();
  @Output() readonly teamChanged = new EventEmitter<void>();
  @Output() readonly quickFilterRequested = new EventEmitter<string>();
  @Output() readonly searchChange = new EventEmitter<string>();
  @Output() readonly fromChange = new EventEmitter<string>();
  @Output() readonly toChange = new EventEmitter<string>();
  @Output() readonly typeFilterChange = new EventEmitter<string>();
  @Output() readonly selectedOrganizationIdChange = new EventEmitter<string>();
  @Output() readonly selectedTeamIdChange = new EventEmitter<string>();
  @Output() readonly unreadOnlyChange = new EventEmitter<boolean>();
}
