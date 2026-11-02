import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupportReply } from '../../../../shared/services/support.service';

@Component({
  selector: 'app-support-ticket-conversation',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './support-ticket-conversation.component.html',
  styleUrl: './support-ticket-conversation.component.scss',
})
export class SupportTicketConversationComponent {
  @Input() replies: SupportReply[] = [];
  @Input() posting = false;

  @Output() submitReply = new EventEmitter<string>();

  replyBody = '';

  onSubmit(): void {
    if (this.posting) return;
    const body = this.replyBody.trim();
    if (!body) return;
    this.submitReply.emit(body);
    this.replyBody = '';
  }
}
