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

  copiedField: string | null = null;

  formatCategory(cat?: string): string {
    return (cat || '').replace(/_/g, ' ');
  }

  formatStatus(status?: string): string {
    if (!status) return 'Unknown';
    return status.replace(/_/g, ' ');
  }

  formatDevice(ua?: string): string {
    if (!ua) return 'Web Client';
    let browser = 'Browser';
    let os = '';

    if (ua.includes('Firefox/')) {
      const match = ua.match(/Firefox\/(\d+(\.\d+)?)/);
      browser = match ? `Firefox ${match[1]}` : 'Firefox';
    } else if (ua.includes('Edg/')) {
      const match = ua.match(/Edg\/(\d+)/);
      browser = match ? `Edge ${match[1]}` : 'Edge';
    } else if (ua.includes('Chrome/')) {
      const match = ua.match(/Chrome\/(\d+)/);
      browser = match ? `Chrome ${match[1]}` : 'Chrome';
    } else if (ua.includes('Safari/') && !ua.includes('Chrome')) {
      browser = 'Safari';
    }

    if (ua.includes('Windows NT 10.0')) os = 'Windows 10/11';
    else if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac OS X')) os = 'macOS';
    else if (ua.includes('Linux')) os = 'Linux';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

    return os ? `${browser} · ${os}` : browser;
  }

  formatRoute(url?: string): string {
    if (!url) return '/app/support';
    try {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        const parsed = new URL(url);
        return parsed.pathname;
      }
    } catch {
      // fallback
    }
    return url;
  }

  copyToClipboard(text?: string, field?: string): void {
    if (!text || !field) return;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        this.copiedField = field;
        setTimeout(() => {
          if (this.copiedField === field) {
            this.copiedField = null;
          }
        }, 2000);
      });
    }
  }
}
