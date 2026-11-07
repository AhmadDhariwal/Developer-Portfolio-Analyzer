import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupportTicket } from '../../../../shared/services/support.service';
import { SupportTicketCardComponent } from '../support-ticket-card/support-ticket-card.component';
import { SupportEmptyStateComponent } from '../support-empty-state/support-empty-state.component';

@Component({
  selector: 'app-support-ticket-list',
  standalone: true,
  imports: [CommonModule, SupportTicketCardComponent, SupportEmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './support-ticket-list.component.html',
  styleUrl: './support-ticket-list.component.scss',
})
export class SupportTicketListComponent {
  @Input() tickets: SupportTicket[] = [];
  @Input() loading = false;
  @Input() page = 1;
  @Input() totalPages = 1;

  @Output() open = new EventEmitter<SupportTicket>();
  @Output() pageChange = new EventEmitter<number>();

  get pageNumbers(): number[] {
    return Array.from({ length: this.totalPages }, (_, i) => i + 1);
  }
}
