import { Component, OnInit, ChangeDetectorRef, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime } from 'rxjs/operators';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  SupportService,
  SupportTicket,
  AdminTicketQuery,
} from '../../shared/services/support.service';
import { SaPagerComponent } from '../shared/components/sa-pager/sa-pager.component';
import { SaSupportDetailComponent } from './sa-support-detail.component';

@Component({
  selector: 'app-sa-support',
  standalone: true,
  imports: [CommonModule, FormsModule, SaPagerComponent, SaSupportDetailComponent],
  templateUrl: './sa-support.component.html',
  styleUrls: ['./sa-support.component.scss'],
})
export class SaSupportComponent implements OnInit {
  tickets: SupportTicket[] = [];
  total = 0;
  page = 1;
  totalPages = 1;
  loading = false;
  error = '';

  search = '';
  status = '';
  category = '';
  priority = '';
  startDate = '';
  endDate = '';
  sort = 'createdAt_desc';

  readonly pageSize = 20;

  selectedId: string | null = null;

  readonly statuses = ['open', 'in_progress', 'resolved', 'closed'];
  readonly categories = [
    'bug',
    'feature_request',
    'account_issue',
    'billing_issue',
    'general_feedback',
    'other',
  ];
  readonly priorities = ['low', 'medium', 'high', 'urgent'];
  readonly sorts = [
    { value: 'createdAt_desc', label: 'Newest first' },
    { value: 'createdAt_asc', label: 'Oldest first' },
    { value: 'priority_desc', label: 'Priority (high to low)' },
    { value: 'status', label: 'Status' },
    { value: 'lastReplyAt_desc', label: 'Recently replied' },
  ];

  private readonly searchInput$ = new Subject<void>();

  constructor(
    private readonly support: SupportService,
    private readonly cdr: ChangeDetectorRef,
    private readonly destroyRef: DestroyRef,
  ) {}

  ngOnInit(): void {
    this.searchInput$
      .pipe(debounceTime(350), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.load(1));
    this.load();
  }

  load(page = 1): void {
    this.loading = true;
    this.error = '';
    this.page = page;

    const params: AdminTicketQuery = {
      page,
      limit: this.pageSize,
      status: this.status || undefined,
      category: this.category || undefined,
      priority: this.priority || undefined,
      startDate: this.startDate || undefined,
      endDate: this.endDate || undefined,
      search: this.search.trim() || undefined,
      sort: this.sort,
    };

    this.support
      .adminGetTickets(params)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.tickets = res?.tickets || [];
          const pagination = res?.pagination || {};
          this.total = pagination.total || 0;
          this.totalPages = pagination.pages || 1;
          this.loading = false;
          try {
            this.cdr.detectChanges();
          } catch {}
        },
        error: (err) => {
          this.tickets = [];
          this.error = err?.error?.message || 'Failed to load support tickets.';
          this.loading = false;
          try {
            this.cdr.detectChanges();
          } catch {}
        },
      });
  }

  onSearchInput(): void {
    this.searchInput$.next();
  }

  reset(): void {
    this.search = '';
    this.status = '';
    this.category = '';
    this.priority = '';
    this.startDate = '';
    this.endDate = '';
    this.sort = 'createdAt_desc';
    this.load(1);
  }

  open(ticket: SupportTicket): void {
    if (!ticket?._id) return;
    this.selectedId = ticket._id;
  }

  closeDetail(): void {
    this.selectedId = null;
  }

  onTicketUpdated(): void {
    this.load(this.page);
  }
}
