import { Component, DestroyRef, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';

import {
  AdminHiringService,
  AdminJob,
  AdminJobPage,
  AdminJobQuery,
  AdminRankedCandidate
} from '../../services/admin-hiring.service';

type JobFormModel = {
  title: string;
  role: string;
  description: string;
  stack: string;
  requiredSkills: string;
  preferredSkills: string;
  minExperienceYears: number;
  location: string;
  employmentType: AdminJob['employmentType'];
  status: AdminJob['status'];
};

type DrawerMode = 'details' | 'edit' | '';

type SortOption = {
  label: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
};

@Component({
  selector: 'app-admin-jobs-page',
  standalone: false,
  templateUrl: './admin-jobs.component.html',
  styleUrls: ['./admin-jobs.component.scss']
})
export class AdminJobsPageComponent implements OnInit {
  @ViewChild('rankingResults') rankingResults?: ElementRef<HTMLElement>;

  private readonly destroyRef = inject(DestroyRef);
  private readonly searchInput$ = new Subject<string>();
  private readonly initialQuery: AdminJobQuery = {
    page: 1,
    limit: 10,
    search: '',
    stack: '',
    status: '',
    employmentType: '',
    location: '',
    sortBy: 'updatedAt',
    sortOrder: 'desc'
  };
  private readonly queryState$ = new BehaviorSubject<AdminJobQuery>(this.initialQuery);

  readonly stackOptions = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
  readonly statusOptions: AdminJob['status'][] = ['open', 'draft', 'closed'];
  readonly employmentTypeOptions: AdminJob['employmentType'][] = ['full-time', 'part-time', 'contract', 'internship'];
  readonly sortOptions: SortOption[] = [
    { label: 'Recently updated', sortBy: 'updatedAt', sortOrder: 'desc' },
    { label: 'Recently created', sortBy: 'createdAt', sortOrder: 'desc' },
    { label: 'Title A-Z', sortBy: 'title', sortOrder: 'asc' },
    { label: 'Status A-Z', sortBy: 'status', sortOrder: 'asc' },
    { label: 'Experience high-low', sortBy: 'minExperienceYears', sortOrder: 'desc' }
  ];

  jobsLoading = false;
  actionLoading = false;
  rankingLoading = false;
  hasLoadedJobs = false;

  message = '';
  messageType: 'success' | 'error' | 'warning' = 'success';
  rankingMessage = '';
  rankingMessageType: 'success' | 'error' | 'warning' = 'success';

  jobs: AdminJob[] = [];
  ranking: AdminRankedCandidate[] = [];

  selectedJobId = '';
  selectedJob: AdminJob | null = null;
  drawerJob: AdminJob | null = null;
  drawerMode: DrawerMode = '';

  searchInput = '';
  stackFilter = '';
  statusFilter = '';
  employmentTypeFilter = '';
  locationFilter = '';
  sortValue = 'updatedAt:desc';

  page = 1;
  pageSize = 10;
  total = 0;
  totalPages = 1;
  hasMore = false;

  form: JobFormModel = this.createEmptyForm();
  editForm: JobFormModel = this.createEmptyForm();

  constructor(private readonly adminService: AdminHiringService) {}

  ngOnInit(): void {
    this.searchInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((search) => this.patchQuery({ search, page: 1 }));

    this.queryState$
      .pipe(
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        tap(() => {
          this.jobsLoading = true;
          this.message = '';
        }),
        switchMap((query) =>
          this.adminService.getJobs(query).pipe(
            catchError(() => {
              this.jobsLoading = false;
              this.hasLoadedJobs = true;
              this.messageType = 'error';
              this.message = 'Failed to load organization jobs.';
              return of<AdminJobPage>({
                jobs: [],
                page: query.page || 1,
                limit: query.limit || 10,
                total: 0,
                totalPages: 1,
                hasMore: false
              });
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response) => {
        this.jobs = response.jobs || [];
        this.page = response.page || 1;
        this.pageSize = response.limit || 10;
        this.total = response.total || 0;
        this.totalPages = response.totalPages || 1;
        this.hasMore = response.hasMore || false;
        this.jobsLoading = false;
        this.hasLoadedJobs = true;

        if (this.selectedJobId) {
          const selected = this.jobs.find((job) => job._id === this.selectedJobId);
          if (selected) {
            this.selectedJob = selected;
          } else if (this.jobs.length > 0) {
            this.selectedJob = this.jobs[0];
            this.selectedJobId = this.jobs[0]._id;
          } else {
            this.selectedJob = null;
            this.selectedJobId = '';
          }
        } else if (this.jobs.length > 0) {
          this.selectedJob = this.jobs[0];
          this.selectedJobId = this.jobs[0]._id;
        }

        if (this.drawerJob) {
          const fresh = this.jobs.find((job) => job._id === this.drawerJob?._id) || this.drawerJob;
          this.drawerJob = fresh;
        }
      });
  }

  get rangeStart(): number {
    return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }

  get activeSort(): SortOption {
    return this.sortOptions.find((option) => `${option.sortBy}:${option.sortOrder}` === this.sortValue) || this.sortOptions[0];
  }

  get pageItems(): Array<number | string> {
    if (this.totalPages <= 7) {
      return Array.from({ length: this.totalPages }, (_, index) => index + 1);
    }

    const pages = new Set<number>([1, this.totalPages, this.page - 1, this.page, this.page + 1]);
    const ordered = Array.from(pages).filter((value) => value >= 1 && value <= this.totalPages).sort((a, b) => a - b);
    const items: Array<number | string> = [];

    ordered.forEach((value, index) => {
      const previous = ordered[index - 1];
      if (index > 0 && previous !== undefined && value - previous > 1) {
        items.push(`ellipsis-${previous}-${value}`);
      }
      items.push(value);
    });

    return items;
  }

  trackByJobId(_: number, job: AdminJob): string {
    return job._id;
  }

  trackByPageItem(index: number, item: number | string): string | number {
    return typeof item === 'number' ? item : `${item}-${index}`;
  }

  onSearchChange(value: string): void {
    this.searchInput = value;
    this.searchInput$.next(value.trim());
  }

  clearSearch(): void {
    this.onSearchChange('');
  }

  onStackChange(value: string): void {
    this.stackFilter = value;
    this.patchQuery({ stack: value, page: 1 });
  }

  onStatusChange(value: string): void {
    this.statusFilter = value;
    this.patchQuery({ status: value, page: 1 });
  }

  onEmploymentTypeChange(value: string): void {
    this.employmentTypeFilter = value;
    this.patchQuery({ employmentType: value, page: 1 });
  }

  onLocationChange(value: string): void {
    this.locationFilter = value;
    this.patchQuery({ location: value.trim(), page: 1 });
  }

  onSortChange(value: string): void {
    this.sortValue = value;
    const [sortBy, sortOrder] = value.split(':');
    this.patchQuery({ sortBy, sortOrder: sortOrder === 'asc' ? 'asc' : 'desc', page: 1 });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page) {
      return;
    }
    this.patchQuery({ page });
  }

  resetFilters(): void {
    this.searchInput = '';
    this.stackFilter = '';
    this.statusFilter = '';
    this.employmentTypeFilter = '';
    this.locationFilter = '';
    this.sortValue = 'updatedAt:desc';
    this.patchQuery({ ...this.initialQuery });
  }

  selectJobForRanking(jobId: string): void {
    this.selectedJobId = jobId;
    this.selectedJob = this.jobs.find((job) => job._id === jobId) || null;
  }

  createJob(): void {
    const validation = this.validateForm(this.form);
    if (validation) {
      this.messageType = 'warning';
      this.message = validation;
      return;
    }

    this.actionLoading = true;
    this.adminService.createJob(this.serializeForm(this.form)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (job) => {
        this.form = this.createEmptyForm();
        this.messageType = 'success';
        this.message = 'Job created successfully.';
        this.actionLoading = false;
        this.selectedJobId = job._id;
        this.refreshCurrentPage(1);
      },
      error: (err) => {
        this.actionLoading = false;
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to create job.');
      }
    });
  }

  openJobDetails(job: AdminJob): void {
    this.drawerJob = job;
    this.drawerMode = 'details';
  }

  openJobEdit(job: AdminJob): void {
    this.drawerJob = job;
    this.drawerMode = 'edit';
    this.editForm = this.toForm(job);
  }

  closeDrawer(): void {
    this.drawerJob = null;
    this.drawerMode = '';
  }

  saveJobEdit(): void {
    if (!this.drawerJob) return;

    const validation = this.validateForm(this.editForm);
    if (validation) {
      this.messageType = 'warning';
      this.message = validation;
      return;
    }

    this.actionLoading = true;
    this.adminService.updateJob(this.drawerJob._id, this.serializeForm(this.editForm)).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.actionLoading = false;
        this.messageType = 'success';
        this.message = 'Job updated successfully.';
        this.closeDrawer();
        this.refreshCurrentPage();
      },
      error: (err) => {
        this.actionLoading = false;
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to update job.');
      }
    });
  }

  closeJob(job: AdminJob): void {
    if (job.status === 'closed') return;
    this.actionLoading = true;
    this.adminService.closeJob(job._id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.actionLoading = false;
        this.messageType = 'success';
        this.message = 'Job closed successfully.';
        this.refreshCurrentPage();
      },
      error: (err) => {
        this.actionLoading = false;
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to close job.');
      }
    });
  }

  deleteJob(job: AdminJob): void {
    if (!window.confirm(`Delete "${job.title}"? This cannot be undone.`)) {
      return;
    }

    this.actionLoading = true;
    this.adminService.deleteJob(job._id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.actionLoading = false;
        this.messageType = 'success';
        this.message = 'Job deleted successfully.';
        if (this.drawerJob?._id === job._id) {
          this.closeDrawer();
        }
        if (this.selectedJobId === job._id) {
          this.selectedJobId = '';
          this.selectedJob = null;
        }
        const nextPage = this.jobs.length === 1 && this.page > 1 ? this.page - 1 : this.page;
        this.refreshCurrentPage(nextPage);
      },
      error: (err) => {
        this.actionLoading = false;
        this.messageType = 'error';
        this.message = String(err?.error?.message || 'Failed to delete job.');
      }
    });
  }

  runRanking(): void {
    if (!this.selectedJobId) {
      this.rankingMessageType = 'warning';
      this.rankingMessage = 'Select a job before running AI ranking.';
      return;
    }

    this.rankingLoading = true;
    this.rankingMessage = '';
    this.adminService.rankCandidates(this.selectedJobId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (ranking) => {
        this.ranking = ranking;
        this.rankingLoading = false;
        this.rankingMessageType = 'success';
        this.rankingMessage = ranking.length
          ? `AI ranking completed for ${ranking.length} candidate${ranking.length !== 1 ? 's' : ''}.`
          : 'AI ranking completed but no candidates matched this job yet.';

        setTimeout(() => {
          this.rankingResults?.nativeElement?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 150);
      },
      error: (err) => {
        this.rankingLoading = false;
        this.ranking = [];
        this.rankingMessageType = 'error';
        this.rankingMessage = String(err?.error?.message || 'Failed to run AI ranking.');
      }
    });
  }

  formatEmploymentType(value?: string): string {
    return String(value || '')
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  scoreBreakdownItems(item: AdminRankedCandidate): Array<{ label: string; value: number }> {
    return Object.entries(item.scoreBreakdown || {}).map(([key, value]) => ({
      label: key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (char) => char.toUpperCase()),
      value: Number(value || 0)
    }));
  }

  private refreshCurrentPage(page = this.page): void {
    this.patchQuery({ page });
  }

  private patchQuery(patch: AdminJobQuery): void {
    const nextQuery = {
      ...this.queryState$.value,
      ...patch
    };

    if (JSON.stringify(nextQuery) === JSON.stringify(this.queryState$.value)) {
      return;
    }

    this.queryState$.next(nextQuery);
  }

  private createEmptyForm(): JobFormModel {
    return {
      title: '',
      role: '',
      description: '',
      stack: 'Full Stack',
      requiredSkills: '',
      preferredSkills: '',
      minExperienceYears: 0,
      location: '',
      employmentType: 'full-time',
      status: 'open'
    };
  }

  private validateForm(form: JobFormModel): string {
    if (!String(form.title || '').trim()) return 'Job title is required.';
    if (!String(form.description || '').trim()) return 'Job description is required.';
    if (String(form.title || '').trim().length < 3) return 'Job title must be at least 3 characters.';
    if (String(form.description || '').trim().length < 20) return 'Job description should be at least 20 characters.';
    if (Number(form.minExperienceYears || 0) < 0) return 'Minimum experience cannot be negative.';
    return '';
  }

  private serializeForm(form: JobFormModel): Partial<AdminJob> {
    return {
      title: String(form.title || '').trim(),
      role: String(form.role || '').trim(),
      description: String(form.description || '').trim(),
      stack: String(form.stack || 'Full Stack').trim(),
      requiredSkills: this.splitSkills(form.requiredSkills),
      preferredSkills: this.splitSkills(form.preferredSkills),
      minExperienceYears: Math.max(0, Number(form.minExperienceYears || 0)),
      location: String(form.location || '').trim(),
      employmentType: form.employmentType,
      status: form.status
    };
  }

  private toForm(job: AdminJob): JobFormModel {
    return {
      title: job.title || '',
      role: job.role || '',
      description: job.description || '',
      stack: job.stack || 'Full Stack',
      requiredSkills: (job.requiredSkills || []).join(', '),
      preferredSkills: (job.preferredSkills || []).join(', '),
      minExperienceYears: Number(job.minExperienceYears || 0),
      location: job.location || '',
      employmentType: job.employmentType || 'full-time',
      status: job.status || 'open'
    };
  }

  private splitSkills(value: string): string[] {
    return String(value || '')
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
}
