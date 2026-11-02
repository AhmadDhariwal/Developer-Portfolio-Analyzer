import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SupportService, SupportTicket } from '../../shared/services/support.service';
import { RecruiterSharedModule } from '../../supervisors/recruiter-shared/recruiter-shared.module';
import {
  SupportCategoryCard,
  SupportFaqItem,
  SupportTicketDraft,
} from './components/support-models';
import { SupportPageHeaderComponent } from './components/support-page-header/support-page-header.component';
import { SupportTicketFormComponent } from './components/support-ticket-form/support-ticket-form.component';
import { SupportTicketListComponent } from './components/support-ticket-list/support-ticket-list.component';
import { SupportTicketDetailsComponent } from './components/support-ticket-details/support-ticket-details.component';
import { SupportFaqComponent } from './components/support-faq/support-faq.component';

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [
    CommonModule,
    RecruiterSharedModule,
    SupportPageHeaderComponent,
    SupportTicketFormComponent,
    SupportTicketListComponent,
    SupportTicketDetailsComponent,
    SupportFaqComponent,
  ],
  templateUrl: './support.html',
  styleUrl: './support.scss',
})
export class SupportComponent implements OnInit {
  supportTickets: SupportTicket[] = [];
  isLoadingTickets = false;

  draft: SupportTicketDraft = {
    category: 'general_feedback',
    priority: 'low',
    subject: '',
    message: '',
    replyToEmail: '',
  };

  isSubmittingTicket = false;
  supportSuccess = '';
  supportError = '';
  supportPage = 1;
  supportTotalPages = 1;
  private latestRequestedPage = 1;

  selectedTicket: SupportTicket | null = null;
  isDeletingTicket = false;
  isPostingReply = false;

  categoryCards: SupportCategoryCard[] = [
    {
      value: 'bug',
      title: 'Report a Bug',
      description: 'Found a bug? Let us know so we can fix it.',
      icon: 'bug_report',
      iconClass: 'icon-bug',
    },
    {
      value: 'feature_request',
      title: 'Request a Feature',
      description: 'Suggest a new feature or improvement.',
      icon: 'lightbulb',
      iconClass: 'icon-feature',
    },
    {
      value: 'other', // fallback for support
      title: 'Contact Support',
      description: 'Get help from our support team.',
      icon: 'headset_mic',
      iconClass: 'icon-support',
    },
    {
      value: 'account_issue',
      title: 'Account Issue',
      description: 'Facing an account or profile related issue?',
      icon: 'person',
      iconClass: 'icon-account',
    },
    {
      value: 'general_feedback',
      title: 'General Feedback',
      description: 'Share your feedback or suggestions.',
      icon: 'chat_bubble',
      iconClass: 'icon-feedback',
    },
  ];

  faqs: SupportFaqItem[] = [
    {
      question: 'How long does it take to get a response?',
      answer: 'We usually respond within 24-48 hours depending on the ticket priority.',
    },
    {
      question: 'How do I report a bug?',
      answer:
        'You can select "Report a Bug" category in the support form above and provide details of the issue.',
    },
    {
      question: 'Facing an account issue?',
      answer:
        'Select "Account Issue" from the categories and describe your problem for priority support.',
    },
    {
      question: 'How do I update my profile or email?',
      answer:
        'Navigate to your Profile Settings from the sidebar to update your personal information or email.',
    },
    {
      question: 'What if I forget my password?',
      answer: 'Use the "Forgot Password" link on the login page to reset it.',
    },
    {
      question: 'Is my sensitive information safe?',
      answer:
        'Yes, we take privacy seriously. Please refrain from sharing highly sensitive info like passwords in support tickets.',
    },
    {
      question: 'What do the ticket statuses mean?',
      answer: 'Open: received, In Progress: being worked on, Resolved: fixed, Closed: completed.',
    },
    {
      question: 'How else can I contact support?',
      answer: 'You can email us directly at support@example.com for urgent inquiries.',
    },
  ];

  // ── Confirm dialog ────────────────────────────────────────────────────
  confirmOpen = false;
  confirmTitle = '';
  confirmMessage = '';
  private pendingConfirmAction: (() => void) | null = null;

  private readonly destroyRef = inject(DestroyRef);

  constructor(
    private readonly cdr: ChangeDetectorRef,
    private readonly supportService: SupportService,
  ) {}

  ngOnInit(): void {
    this.loadSupportTickets();
  }

  loadSupportTickets(page: number = 1): void {
    this.isLoadingTickets = true;
    this.supportPage = page;
    this.latestRequestedPage = page;
    this.supportService
      .getMyTickets(page, 5)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (page !== this.latestRequestedPage) return;
          this.supportTickets = res.tickets || [];
          this.supportTotalPages = res.pagination?.pages || 1;
          this.isLoadingTickets = false;
          if (this.selectedTicket) {
            const refreshed = this.supportTickets.find((t) => t._id === this.selectedTicket?._id);
            if (refreshed) this.selectedTicket = refreshed;
          }
          this.cdr.detectChanges();
        },
        error: () => {
          if (page !== this.latestRequestedPage) return;
          this.isLoadingTickets = false;
          this.cdr.detectChanges();
        },
      });
  }

  openTicketDetails(ticket: SupportTicket): void {
    this.selectedTicket = ticket;
  }

  closeTicketDetails(): void {
    this.selectedTicket = null;
  }

  submitSupportTicket(draft: SupportTicketDraft): void {
    if (this.isSubmittingTicket) return;
    if (!draft.subject.trim() || !draft.message.trim()) {
      this.draft = { ...draft };
      this.supportError = 'Subject and message are required.';
      return;
    }
    this.draft = { ...draft };
    this.isSubmittingTicket = true;
    this.supportError = '';
    this.supportSuccess = '';

    const payload = {
      category: draft.category,
      priority: draft.priority,
      subject: draft.subject,
      message: draft.message,
      replyToEmail: draft.replyToEmail,
      sourcePage: window.location.href,
      browserInfo: navigator.userAgent,
    };

    this.supportService
      .createTicket(payload)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.supportSuccess = 'Support request submitted successfully.';
          this.isSubmittingTicket = false;
          // Clear subject/message only after a 201; keep category/priority/replyToEmail.
          this.draft = { ...this.draft, subject: '', message: '' };
          this.loadSupportTickets(1);
          this.cdr.detectChanges();
          setTimeout(() => {
            this.supportSuccess = '';
            this.cdr.detectChanges();
          }, 5000);
        },
        error: (err: any) => {
          this.isSubmittingTicket = false;
          // Draft retention: keep all entered fields on error.
          this.supportError = err?.error?.message || 'Failed to submit request. Please try again.';
          this.cdr.detectChanges();
        },
      });
  }

  submitReply(body: string): void {
    const ticket = this.selectedTicket;
    if (!ticket?._id || this.isPostingReply) return;
    const trimmed = (body || '').trim();
    if (!trimmed) return;
    this.isPostingReply = true;
    this.supportService
      .addReply(ticket._id, trimmed)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isPostingReply = false;
          this.loadSupportTickets(this.supportPage);
          this.cdr.detectChanges();
        },
        error: (err: any) => {
          this.isPostingReply = false;
          this.supportError = err?.error?.message || 'Failed to send reply. Please try again.';
          this.cdr.detectChanges();
        },
      });
  }

  deleteTicket(id: string | undefined): void {
    if (!id) return;

    this.openConfirm(
      'Delete Ticket',
      'Warning: This ticket will be deleted permanently. Are you sure you want to proceed?',
      () => {
        this.isDeletingTicket = true;
        this.supportService
          .deleteTicket(id)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: () => {
              this.supportSuccess = 'Ticket deleted successfully.';
              this.isDeletingTicket = false;
              this.selectedTicket = null;
              this.loadSupportTickets(this.supportPage);
              this.cdr.detectChanges();
              setTimeout(() => {
                this.supportSuccess = '';
                this.cdr.detectChanges();
              }, 5000);
            },
            error: (err: any) => {
              this.isDeletingTicket = false;
              this.supportError = err?.error?.message || 'Failed to delete ticket.';
              this.cdr.detectChanges();
            },
          });
      },
    );
  }

  private openConfirm(title: string, message: string, action: () => void): void {
    this.confirmTitle = title;
    this.confirmMessage = message;
    this.pendingConfirmAction = action;
    this.confirmOpen = true;
  }

  onConfirmAccepted(): void {
    this.confirmOpen = false;
    this.pendingConfirmAction?.();
    this.pendingConfirmAction = null;
  }

  onConfirmCancelled(): void {
    this.confirmOpen = false;
    this.pendingConfirmAction = null;
  }

  selectCategory(value: string): void {
    this.draft = { ...this.draft, category: value };
  }
}
