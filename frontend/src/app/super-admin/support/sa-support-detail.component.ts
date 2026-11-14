import {
  Component,
  OnInit,
  Input,
  Output,
  EventEmitter,
  ChangeDetectorRef,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SupportService, SupportTicket } from '../../shared/services/support.service';
import { SaModalComponent } from '../shared/components/sa-modal/sa-modal.component';

const REPLY_CAP = 100;
const STALE_WRITE_MESSAGE = 'This ticket was updated by someone else. Reload and try again.';

@Component({
  selector: 'app-sa-support-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, SaModalComponent],
  templateUrl: './sa-support-detail.component.html',
  styleUrls: ['./sa-support-detail.component.scss'],
})
export class SaSupportDetailComponent implements OnInit {
  @Input({ required: true }) ticketId!: string;
  @Output() close = new EventEmitter<void>();
  @Output() updated = new EventEmitter<void>();

  ticket: SupportTicket | null = null;
  loading = false;
  loadError = '';

  statusValue = '';
  statusBusy = false;
  statusError = '';

  replyBody = '';
  replyBusy = false;
  replyError = '';

  readonly statuses = ['open', 'in_progress', 'resolved', 'closed'];

  constructor(
    private readonly support: SupportService,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef,
  ) {}

  ngOnInit(): void {
    this.fetch();
  }

  get replyCount(): number {
    return this.ticket?.replies?.length ?? 0;
  }

  get replyCapReached(): boolean {
    return this.replyCount >= REPLY_CAP;
  }

  fetch(): void {
    this.loading = true;
    this.loadError = '';
    this.support
      .adminGetTicket(this.ticketId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.ticket = res?.ticket || res || null;
          this.statusValue = this.ticket?.status || '';
          this.loading = false;
          try {
            this.cdr.detectChanges();
          } catch {}
        },
        error: (err) => {
          this.loadError = err?.error?.message || 'Failed to load the ticket.';
          this.loading = false;
          try {
            this.cdr.detectChanges();
          } catch {}
        },
      });
  }

  onStatusChange(): void {
    if (!this.ticket?._id || !this.ticket.updatedAt) return;
    if (this.statusValue === this.ticket.status) return;

    this.statusBusy = true;
    this.statusError = '';

    this.support
      .adminUpdateStatus(this.ticket._id, this.statusValue, this.ticket.updatedAt)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.ticket = res?.ticket || this.ticket;
          this.statusValue = this.ticket?.status || this.statusValue;
          this.statusBusy = false;
          this.updated.emit();
          try {
            this.cdr.detectChanges();
          } catch {}
        },
        error: (err) => {
          this.statusBusy = false;
          if (err?.status === 409) {
            this.statusError = STALE_WRITE_MESSAGE;
            this.fetch();
          } else {
            this.statusError = err?.error?.message || 'Failed to update the status.';
            this.statusValue = this.ticket?.status || '';
          }
          try {
            this.cdr.detectChanges();
          } catch {}
        },
      });
  }

  sendReply(): void {
    const body = this.replyBody.trim();
    if (!this.ticket?._id || !body || this.replyBusy || this.replyCapReached) return;

    this.replyBusy = true;
    this.replyError = '';

    this.support
      .adminReply(this.ticket._id, body)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.ticket = res?.ticket || this.ticket;
          this.replyBody = '';
          this.replyBusy = false;
          this.updated.emit();
          try {
            this.cdr.detectChanges();
          } catch {}
        },
        error: (err) => {
          this.replyBusy = false;
          this.replyError = err?.error?.message || 'Failed to send the reply.';
          try {
            this.cdr.detectChanges();
          } catch {}
        },
      });
  }

  authorLabel(role: string): string {
    return role === 'admin' ? 'You (Support)' : 'User';
  }

  closeDetail(): void {
    this.close.emit();
  }
}
