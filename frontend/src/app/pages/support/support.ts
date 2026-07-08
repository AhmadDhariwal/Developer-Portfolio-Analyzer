import { Component, OnInit, ChangeDetectorRef, DestroyRef, inject, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { SupportService, SupportTicket } from '../../shared/services/support.service';

interface CategoryCard {
  value: string;
  title: string;
  description: string;
  icon: string;
  iconClass: string;
}

interface FaqItem {
  question: string;
  answer: string;
  isOpen: boolean;
}

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './support.html',
  styleUrl: './support.scss',
})
export class SupportComponent implements OnInit {
  @ViewChild('supportFormElement') supportFormElement!: ElementRef;

  supportTickets: SupportTicket[] = [];
  isLoadingTickets = false;
  
  supportForm = {
    category: 'general_feedback',
    priority: 'low',
    subject: '',
    message: '',
    contactEmail: ''
  };
  
  isSubmittingTicket = false;
  supportSuccess = '';
  supportError = '';
  supportPage = 1;
  supportTotalPages = 1;

  categoryCards: CategoryCard[] = [
    {
      value: 'bug',
      title: 'Report a Bug',
      description: 'Found a bug? Let us know so we can fix it.',
      icon: 'bug_report',
      iconClass: 'icon-bug'
    },
    {
      value: 'feature_request',
      title: 'Request a Feature',
      description: 'Suggest a new feature or improvement.',
      icon: 'lightbulb',
      iconClass: 'icon-feature'
    },
    {
      value: 'other', // fallback for support
      title: 'Contact Support',
      description: 'Get help from our support team.',
      icon: 'headset_mic',
      iconClass: 'icon-support'
    },
    {
      value: 'account_issue',
      title: 'Account Issue',
      description: 'Facing an account or profile related issue?',
      icon: 'person',
      iconClass: 'icon-account'
    },
    {
      value: 'general_feedback',
      title: 'General Feedback',
      description: 'Share your feedback or suggestions.',
      icon: 'chat_bubble',
      iconClass: 'icon-feedback'
    }
  ];

  faqs: FaqItem[] = [
    { question: 'How long does it take to get a response?', answer: 'We usually respond within 24-48 hours depending on the ticket priority.', isOpen: false },
    { question: 'How do I delete my account?', answer: 'You can delete your account from the Profile Settings page under the Danger Zone section.', isOpen: false },
    { question: 'How do I update my email or profile?', answer: 'Navigate to your Profile Settings from the sidebar to update your personal information.', isOpen: false },
    { question: 'Where can I view my subscription?', answer: 'Your subscription details are available under the Billing & Subscription section in Settings.', isOpen: false }
  ];

  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);

  constructor(
    private readonly cdr: ChangeDetectorRef,
    private readonly supportService: SupportService
  ) {}

  ngOnInit(): void {
    this.loadSupportTickets();
  }

  loadSupportTickets(page: number = 1): void {
    this.isLoadingTickets = true;
    this.supportPage = page;
    this.supportService.getMyTickets(page, 5).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (res) => {
        this.supportTickets = res.tickets || [];
        this.supportTotalPages = res.pagination?.pages || 1;
        this.isLoadingTickets = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.isLoadingTickets = false;
        this.cdr.detectChanges();
      }
    });
  }

  selectCategory(value: string): void {
    this.supportForm.category = value;
    if (this.supportFormElement) {
      this.supportFormElement.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  toggleFaq(index: number): void {
    this.faqs[index].isOpen = !this.faqs[index].isOpen;
  }

  submitSupportTicket(): void {
    if (!this.supportForm.subject.trim() || !this.supportForm.message.trim()) {
      this.supportError = 'Subject and message are required.';
      return;
    }
    this.isSubmittingTicket = true;
    this.supportError = '';
    this.supportSuccess = '';
    
    const payload = {
      ...this.supportForm,
      email: this.supportForm.contactEmail
    };

    this.supportService.createTicket(payload).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: () => {
        this.supportSuccess = 'Support request submitted successfully.';
        this.isSubmittingTicket = false;
        this.supportForm.subject = '';
        this.supportForm.message = '';
        this.loadSupportTickets(1);
        this.cdr.detectChanges();
        setTimeout(() => { this.supportSuccess = ''; this.cdr.detectChanges(); }, 5000);
      },
      error: (err) => {
        this.isSubmittingTicket = false;
        this.supportError = err?.error?.message || 'Failed to submit request. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  formatCategory(cat: string): string {
    return cat.replace(/_/g, ' ');
  }

  formatStatus(status?: string): string {
    if (!status) return 'Unknown';
    return status.replace(/_/g, ' ');
  }
}
