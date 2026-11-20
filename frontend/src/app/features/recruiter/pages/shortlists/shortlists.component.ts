import { ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { PerformanceChartItem } from '../../components/recruiter-performance-chart/recruiter-performance-chart.component';
import { RecruiterMatchService } from '../../services/recruiter-match.service';

export type ShortlistStageFilter =
  | 'all'
  | 'shortlisted'
  | 'reviewing'
  | 'contacted'
  | 'interview'
  | 'rejected';

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  action: (() => void) | null;
}

@Component({
  selector: 'app-recruiter-shortlists',
  templateUrl: './shortlists.component.html',
  styleUrl: './shortlists.component.scss',
  standalone: false,
})
export class ShortlistsComponent implements OnInit {
  private readonly cdr = inject(ChangeDetectorRef);
  loading = true;
  error = '';
  notice = '';
  shortlists: any[] = [];
  stageFilter: ShortlistStageFilter = 'all';
  jobFilter = '';
  searchTerm = '';
  savingNoteId = '';

  readonly confirmState = signal<ConfirmState>({
    open: false,
    title: '',
    message: '',
    confirmText: 'Confirm',
    action: null,
  });

  private readonly stageSequence = ['shortlisted', 'reviewing', 'contacted', 'interview'];

  constructor(private matchService: RecruiterMatchService) {}

  ngOnInit(): void {
    this.loadShortlists();
  }

  get activeCount(): number {
    return this.shortlists.filter((item) => {
      const status = String(item?.status || 'shortlisted').toLowerCase();
      return !['interview', 'rejected'].includes(status);
    }).length;
  }

  get interviewCount(): number {
    return this.countByStage('interview');
  }

  get rejectedCount(): number {
    return this.countByStage('rejected');
  }

  get conversionDisplay(): string {
    if (!this.shortlists.length) {
      return '0%';
    }
    return `${Math.round((this.interviewCount / this.shortlists.length) * 100)}%`;
  }

  get stageChartItems(): PerformanceChartItem[] {
    if (!this.shortlists.length) {
      return [];
    }
    return [
      { label: 'Shortlisted', count: this.countByStage('shortlisted') },
      { label: 'Reviewing', count: this.countByStage('reviewing') },
      { label: 'Contacted', count: this.countByStage('contacted') },
      { label: 'Interview', count: this.countByStage('interview') },
      { label: 'Rejected', count: this.rejectedCount },
    ];
  }

  get uniqueJobTitles(): string[] {
    const titles = new Set<string>();
    for (const item of this.shortlists) {
      const title = String(item?.job?.title || '').trim();
      if (title) {
        titles.add(title);
      }
    }
    return Array.from(titles).sort((a, b) => a.localeCompare(b));
  }

  get filteredShortlists(): any[] {
    const query = this.searchTerm.trim().toLowerCase();
    return this.shortlists.filter((item) => {
      const status = String(item?.status || 'shortlisted').toLowerCase();
      if (this.stageFilter !== 'all' && status !== this.stageFilter) {
        return false;
      }
      if (this.jobFilter && String(item?.job?.title || '').trim() !== this.jobFilter) {
        return false;
      }
      if (!query) {
        return true;
      }
      const haystack = [
        item?.candidate?.name,
        item?.candidate?.fullName,
        item?.candidate?.stack,
        item?.job?.title,
        item?.notes,
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }

  countByStage(stage: string): number {
    return this.shortlists.filter(
      (item) => String(item?.status || 'shortlisted').toLowerCase() === stage,
    ).length;
  }

  stageRatio(stage: string): number {
    if (!this.shortlists.length) {
      return 0;
    }
    return Math.round((this.countByStage(stage) / this.shortlists.length) * 100);
  }

  setStageFilter(stage: ShortlistStageFilter): void {
    this.stageFilter = stage;
  }

  loadShortlists(): void {
    this.loading = true;
    this.error = '';

    this.matchService
      .getShortlists()
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response: any) => {
          this.shortlists = response?.shortlists || [];
          this.loading = false;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Unable to load shortlists right now.';
          this.loading = false;
        },
      });
  }

  advance(item: any): void {
    const id = String(item?._id || '').trim();
    if (!id) {
      return;
    }
    const currentStatus = String(item?.status || 'shortlisted').toLowerCase();
    const index = this.stageSequence.indexOf(currentStatus);
    const nextStatus =
      index >= 0 ? this.stageSequence[(index + 1) % this.stageSequence.length] : 'shortlisted';
    const candidateName = item?.candidate?.name || 'this candidate';

    this.confirmState.set({
      open: true,
      title: 'Advance shortlist stage',
      message: `Move ${candidateName} to stage "${nextStatus}"?`,
      confirmText: `Move to ${nextStatus}`,
      action: () => this.applyStageUpdate(item, nextStatus),
    });
  }

  advanceStage(item: any): void {
    this.advance(item);
  }

  changeStage(event: { item: any; status: string }): void {
    const { item, status } = event;
    const id = String(item?._id || '').trim();
    if (!id || !status) {
      return;
    }
    const currentStatus = String(item?.status || 'shortlisted').toLowerCase();
    if (status === currentStatus) {
      return;
    }
    if (status === 'rejected') {
      const candidateName = item?.candidate?.name || 'this candidate';
      this.confirmState.set({
        open: true,
        title: 'Mark as rejected',
        message: `Move ${candidateName} to the Rejected stage for this shortlist?`,
        confirmText: 'Mark Rejected',
        action: () => this.applyStageUpdate(item, status),
      });
      return;
    }
    this.applyStageUpdate(item, status);
  }

  updateNotes(event: { item: any; notes: string }): void {
    const id = String(event?.item?._id || '').trim();
    if (!id) {
      return;
    }
    this.savingNoteId = id;
    this.error = '';
    this.notice = '';

    this.matchService
      .updateShortlist(id, { notes: event.notes })
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response: any) => {
          const updated = response?.shortlist;
          event.item.notes = updated?.notes ?? event.notes;
          this.savingNoteId = '';
          this.notice = `Saved notes for ${event.item?.candidate?.name || 'candidate'}.`;
        },
        error: (err) => {
          this.savingNoteId = '';
          this.error = err?.error?.message || 'Could not update shortlist notes.';
        },
      });
  }

  remove(item: any): void {
    const id = String(item?._id || '').trim();
    if (!id) {
      return;
    }
    const candidateName = item?.candidate?.name || 'this candidate';
    this.confirmState.set({
      open: true,
      title: 'Remove shortlist entry',
      message: `Remove ${candidateName} from this shortlist?`,
      confirmText: 'Remove',
      action: () => {
        this.error = '';
        this.notice = '';

        this.matchService
          .removeShortlist(id)
          .pipe(finalize(() => this.cdr.markForCheck()))
          .subscribe({
            next: () => {
              this.shortlists = this.shortlists.filter((entry) => entry._id !== id);
              this.notice = `Removed ${item?.candidate?.name || 'candidate'} from shortlist.`;
            },
            error: (err) => {
              this.error = err?.error?.message || 'Could not remove shortlist entry.';
            },
          });
      },
    });
  }

  onConfirmAccepted(): void {
    const action = this.confirmState().action;
    this.confirmState.set({
      open: false,
      title: '',
      message: '',
      confirmText: 'Confirm',
      action: null,
    });
    action?.();
  }

  onConfirmCancelled(): void {
    this.confirmState.set({
      open: false,
      title: '',
      message: '',
      confirmText: 'Confirm',
      action: null,
    });
  }

  trackByItem(_: number, item: any): string {
    return String(item?._id || _);
  }

  private applyStageUpdate(item: any, nextStatus: string): void {
    const id = String(item?._id || '').trim();
    if (!id) {
      return;
    }
    this.error = '';
    this.notice = '';

    this.matchService
      .updateShortlist(id, { status: nextStatus })
      .pipe(finalize(() => this.cdr.markForCheck()))
      .subscribe({
        next: (response: any) => {
          const updated = response?.shortlist;
          item.status = updated?.status || nextStatus;
          this.notice = `Updated ${item?.candidate?.name || 'candidate'} to stage "${item.status}".`;
        },
        error: (err) => {
          this.error = err?.error?.message || 'Could not update shortlist stage.';
        },
      });
  }
}
