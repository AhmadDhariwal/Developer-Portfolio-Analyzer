import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-contact-page',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './contact-page.component.html',
  styleUrl: './contact-page.component.scss',
})
export class ContactPageComponent {
  readonly pageLinks = [
    { label: 'Privacy', route: '/privacy' },
    { label: 'Terms', route: '/terms' },
    { label: 'API Docs', route: '/api-docs' },
    { label: 'Blog', route: '/blog' },
    { label: 'Contact', route: '/contact' },
  ];

  readonly primaryContact = 'devinsight.ai.help@gmail.com';
  readonly backupPhone = '+92 300 123 4567';
  readonly supportChannels = [
    {
      title: 'Product support',
      detail: 'Account access, onboarding, recruiter hub questions, and workflow help.',
    },
    {
      title: 'Admin setup',
      detail: 'Organization setup, recruiter visibility, and RBAC-related guidance.',
    },
    {
      title: 'API and integration',
      detail: 'Questions around internal integration, endpoint usage, and product capabilities.',
    },
  ];

  openPrimaryContact(): void {
    this.openContact(this.primaryContact);
  }

  openBackupPhone(): void {
    this.openContact(this.backupPhone);
  }

  private openContact(value: string): void {
    const trimmed = String(value || '').trim();
    if (!trimmed || typeof window === 'undefined') return;

    if (this.isEmail(trimmed)) {
      if (trimmed.toLowerCase().endsWith('@gmail.com')) {
        window.open(
          `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(trimmed)}`,
          '_blank',
          'noopener,noreferrer',
        );
        return;
      }

      window.location.href = `mailto:${trimmed}`;
      return;
    }

    window.location.href = `tel:${trimmed.replace(/[^\d+]/g, '')}`;
  }

  private isEmail(value: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }
}
