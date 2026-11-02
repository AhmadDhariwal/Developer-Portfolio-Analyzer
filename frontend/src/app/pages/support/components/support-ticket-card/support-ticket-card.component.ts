import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SupportTicket } from '../../../../shared/services/support.service';

@Component({
  selector: 'app-support-ticket-card',
  standalone: true,
  imports: [CommonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './support-ticket-card.component.html',
  styleUrl: './support-ticket-card.component.scss',
})
export class SupportTicketCardComponent {
  @Input() ticket!: SupportTicket;

  @Output() open = new EventEmitter<SupportTicket>();

  get categoryIcon(): string {
    switch (this.ticket?.category) {
      case 'bug':
        return 'bug_report';
      case 'feature_request':
        return 'lightbulb';
      case 'account_issue':
        return 'person';
      case 'general_feedback':
        return 'chat_bubble';
      default:
        return 'headset_mic';
    }
  }

  formatCategory(cat: string): string {
    return (cat || '').replace(/_/g, ' ');
  }

  formatStatus(status?: string): string {
    if (!status) return 'Unknown';
    return status.replace(/_/g, ' ');
  }
}
