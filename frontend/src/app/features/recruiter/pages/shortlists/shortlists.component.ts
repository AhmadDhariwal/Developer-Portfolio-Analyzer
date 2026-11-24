import { ChangeDetectorRef, Component, OnInit, inject, signal } from '@angular/core';
import { finalize } from 'rxjs/operators';
import { ActivatedRoute } from '@angular/router';
import { PerformanceChartItem } from '../../components/recruiter-performance-chart/recruiter-performance-chart.component';
import { RecruiterMatchService } from '../../services/recruiter-match.service';
import { JobApplicationsService } from '../../../../shared/services/job-applications.service';

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
  private readonly applications = inject(JobApplicationsService);
  private readonly route = inject(ActivatedRoute, { optional: true });
  source: 'public' | 'applications' = 'public';
  private loadVersion = 0;
  loading = true;
  error = '';
  notice = '';
  shortlists: any[] = [];
  stageFilter: ShortlistStageFilter = 'all';
  jobFilter = '';
  searchTerm = '';
  savingNoteId = '';
  applicationPage = 1;
  readonly applicationLimit = 20;
  applicationTotal = 0;
  applicationPages = 0;
  changingApplicationId = '';

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
    if (this.route?.snapshot?.queryParamMap?.get('source') === 'applications')
      this.source = 'applications';
    this.loadShortlists();
  }
  setSource(source: 'public' | 'applications'): void {
    if (source === this.source) return;
    this.source = source;
    this.applicationPage = 1;
    this.applicationTotal = 0;
    this.applicationPages = 0;
    this.shortlists = [];
    this.notice = '';
    this.jobFilter = '';
    this.searchTerm = '';
    this.stageFilter = 'all';
    this.onConfirmCancelled();
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

  changeApplicationPage(page: number): void {
    if (this.loading || page < 1 || page > this.applicationPages) return;
    this.applicationPage = page;
    this.loadShortlists();
  }

  loadShortlists(message = ''): void {
    const version = ++this.loadVersion;
    const source = this.source;
    this.loading = true;
    this.error = '';
    this.notice = message;
    this.savingNoteId = '';
    this.changingApplicationId = '';
    this.shortlists = [];
    this.onConfirmCancelled();

    const request =
      source === 'applications'
        ? this.matchService.getApplicationShortlists(this.applicationPage, this.applicationLimit)
        : this.matchService.getShortlists();
    request.pipe(finalize(() => this.cdr.markForCheck())).subscribe({
      next: (response: any) => {
        if (version !== this.loadVersion || source !== this.source) return;
        this.shortlists = response?.shortlists || [];
        if (source === 'applications') {
          this.applicationTotal = response?.meta?.total ?? this.shortlists.length;
          this.applicationPages = response?.meta?.pages ?? 1;
          if (this.applicationPage > Math.max(1, this.applicationPages)) {
            this.applicationPage = Math.max(1, this.applicationPages);
            this.loadShortlists(message);
            return;
          }
        }
        this.loading = false;
      },
      error: (err) => {
        if (version !== this.loadVersion || source !== this.source) return;
        this.shortlists = [];
        this.applicationTotal = 0;
        this.applicationPages = 0;
        this.error = err?.error?.message || 'Unable to load shortlists right now.';
        this.loading = false;
      },
    });
  }

  changeApplicationStatus(event: { item: any; status: string }): void {
    const { item, status } = event;
    if (
      this.loading ||
      this.changingApplicationId ||
      this.source !== 'applications' ||
      !this.shortlists.includes(item) ||
      item?.access?.manageApplicationStatus !== true ||
      !item.applicationId ||
      !item.application?.permittedStatuses?.includes(status)
    )
      return;
    const expectedStatus = item.application.status;
    const version = this.loadVersion;
    const apply = () => {
      if (version !== this.loadVersion || this.changingApplicationId) return;
      this.changingApplicationId = item._id;
      this.error = '';
      this.notice = '';
      this.applications
        .status(item.jobId, item.applicationId, status, expectedStatus)
        .pipe(finalize(() => this.cdr.markForCheck()))
        .subscribe({
          next: () => {
            if (version !== this.loadVersion) return;
            this.loadShortlists(
              `Application status updated to ${status}. Internal stage is unchanged.`,
            );
          },
          error: (error) => {
            if (version !== this.loadVersion) return;
            this.changingApplicationId = '';
            this.refreshAfterDenied(error);
            this.error =
              error?.status === 409
                ? 'Application changed. Refreshed the current status; review it before trying again.'
                : error?.error?.message || 'Unable to update application status. Please retry.';
          },
        });
    };
    if (status === 'rejected') {
      this.confirmState.set({
        open: true,
        title: 'Reject application',
        message:
          'Reject this application and notify the applicant? This is terminal. Internal notes and stage are retained.',
        confirmText: 'Reject application',
        action: apply,
      });
    } else apply();
  }

  advance(item: any): void {
    if (item?.access?.manage !== true) return;
    if (item.applicationId && !item.access.manageStages) return;
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
    if (event.item?.access?.manage !== true) return;
    if (event.item.applicationId && !event.item.access.manageStages) return;
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
    if (event.item?.access?.manage !== true) return;
    const id = String(event?.item?._id || '').trim();
    if (!id) {
      return;
    }
    this.savingNoteId = id;
    this.error = '';
    this.notice = '';
    const version = this.loadVersion;

    const request = event.item.applicationId
      ? this.matchService.updateApplicationShortlist(id, {
          notes: event.notes,
          expectedVersion: event.item.version,
        })
      : this.matchService.updateShortlist(id, {
          notes: event.notes,
          expectedVersion: event.item.version,
        });
    request.pipe(finalize(() => this.cdr.markForCheck())).subscribe({
      next: (response: any) => {
        if (version !== this.loadVersion) return;
        const updated = response?.shortlist;
        Object.assign(event.item, updated || { notes: event.notes });
        this.savingNoteId = '';
        this.notice = `Saved notes for ${event.item?.candidate?.name || 'candidate'}.`;
      },
      error: (err) => {
        if (version !== this.loadVersion) return;
        this.savingNoteId = '';
        this.refreshAfterDenied(err);
        this.error = err?.error?.message || 'Could not update shortlist notes.';
      },
    });
  }

  remove(item: any): void {
    if (item?.access?.manage !== true) return;
    if (item.applicationId) return;
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
              this.refreshAfterDenied(err);
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

  private refreshAfterDenied(error: any): void {
    if ([403, 404, 409].includes(error?.status)) {
      this.shortlists = [];
      this.loadShortlists();
    }
  }

  trackByItem(_: number, item: any): string {
    return String(item?._id || _);
  }

  private applyStageUpdate(item: any, nextStatus: string): void {
    if (item?.access?.manage !== true) return;
    if (item.applicationId && !item.access.manageStages) return;
    const id = String(item?._id || '').trim();
    if (!id) {
      return;
    }
    this.error = '';
    this.notice = '';
    const version = this.loadVersion;

    const request = item.applicationId
      ? this.matchService.updateApplicationShortlist(id, {
          status: nextStatus,
          expectedVersion: item.version,
        })
      : this.matchService.updateShortlist(id, {
          status: nextStatus,
          expectedVersion: item.version,
        });
    request.pipe(finalize(() => this.cdr.markForCheck())).subscribe({
      next: (response: any) => {
        if (version !== this.loadVersion) return;
        const updated = response?.shortlist;
        Object.assign(item, updated || { status: nextStatus });
        this.notice = `Updated ${item?.candidate?.name || 'candidate'} to stage "${item.status}".`;
      },
      error: (err) => {
        if (version !== this.loadVersion) return;
        this.refreshAfterDenied(err);
        this.error = err?.error?.message || 'Could not update shortlist stage.';
      },
    });
  }
}
