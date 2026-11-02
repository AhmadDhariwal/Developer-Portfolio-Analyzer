import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupportTicket } from '../../../../shared/services/support.service';
import { SupportTicketConversationComponent } from '../support-ticket-conversation/support-ticket-conversation.component';

@Component({
  selector: 'app-support-ticket-details',
  standalone: true,
  imports: [CommonModule, SupportTicketConversationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './support-ticket-details.component.html',
  styleUrl: './support-ticket-details.component.scss',
})
export class SupportTicketDetailsComponent {
  @Input() ticket!: SupportTicket;
  @Input() deleting = false;
  @Input() replyPosting = false;

  @Output() close = new EventEmitter<void>();
  @Output() delete = new EventEmitter<string | undefined>();
  @Output() reply = new EventEmitter<string>();

  formatCategory(cat: string): string {
    return (cat || '').replace(/_/g, ' ');
  }

  formatStatus(status?: string): string {
    if (!status) return 'Unknown';
    return status.replace(/_/g, ' ');
  }
}
