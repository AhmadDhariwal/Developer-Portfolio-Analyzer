import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { PublicSubpageShellComponent } from '../../shared/components/public-subpage-shell/public-subpage-shell.component';

@Component({
  selector: 'app-contact-page',
  standalone: true,
  imports: [CommonModule, PublicSubpageShellComponent],
  templateUrl: './contact-page.component.html',
  styleUrl: './contact-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactPageComponent {
  readonly primaryContact = 'devinsight.ai.help@gmail.com';
  readonly backupPhone = '+92 300 123 4567';
  readonly copiedChannel = signal<'email' | 'phone' | null>(null);

  readonly supportChannels = [
    {
      tag: 'ONBOARDING',
      title: 'Product support',
      detail:
        'Account access, workspace onboarding, recruiter hub workflows, and portfolio troubleshooting.',
    },
    {
      tag: 'RBAC',
      title: 'Admin & organization setup',
      detail:
        'Organization provisioning, recruiter permissions, invitation links, and tenant isolation guidance.',
    },
    {
      tag: 'PLATFORM',
      title: 'API & integration inquiries',
      detail:
        'Payload conventions, GitHub/Google OAuth sign-in support, and technical clarification.',
    },
  ] as const;

  openPrimaryContact(): void {
    this.openContact(this.primaryContact);
  }

  openBackupPhone(): void {
    this.openContact(this.backupPhone);
  }

  copyValue(type: 'email' | 'phone'): void {
    const value = type === 'email' ? this.primaryContact : this.backupPhone;
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }
    navigator.clipboard.writeText(value).then(
      () => {
        this.copiedChannel.set(type);
      },
      () => {
        this.copiedChannel.set(null);
      },
    );
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
