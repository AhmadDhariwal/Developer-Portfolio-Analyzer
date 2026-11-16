import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupportCategoryCard, SupportTicketDraft } from '../support-models';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

@Component({
  selector: 'app-support-ticket-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './support-ticket-form.component.html',
  styleUrl: './support-ticket-form.component.scss',
})
export class SupportTicketFormComponent {
  @Input() submitting = false;
  @Input() error = '';
  @Input() success = '';

  @Input() set draft(value: SupportTicketDraft | null | undefined) {
    if (value) {
      this.model = { ...value };
    }
  }

  @Input() categoryCards: SupportCategoryCard[] = [];

  @Output() submitTicket = new EventEmitter<SupportTicketDraft>();

  model: SupportTicketDraft = {
    category: 'general_feedback',
    priority: 'low',
    subject: '',
    message: '',
    replyToEmail: '',
  };

  replyToInvalid = false;

  onReplyToChange(): void {
    const value = (this.model.replyToEmail || '').trim();
    this.replyToInvalid = value.length > 0 && !EMAIL_PATTERN.test(value);
  }

  onSubmit(): void {
    if (this.submitting) return;
    this.onReplyToChange();
    if (this.replyToInvalid) return;
    this.submitTicket.emit({ ...this.model });
  }
}
