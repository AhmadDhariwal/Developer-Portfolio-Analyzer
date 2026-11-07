import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterModule } from '@angular/router';
import {
  Subscription,
  combineLatest,
  distinctUntilChanged,
  map,
  switchMap,
  from,
  mergeMap,
  of,
  throwError,
  catchError,
  toArray,
  finalize,
} from 'rxjs';
import { JobService } from '../../shared/services/job.service';
import { JobActionsService } from '../../shared/services/job-actions.service';
import { AuthService } from '../../shared/services/auth.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import {
  DEFAULT_JOB_FILTERS,
  Job,
  JobActionField,
  JobActionRecord,
  JobFilters,
  JobsResponse,
  normalizeJobFilters,
} from '../../shared/models/job.model';
import { JobCardComponent } from '../../shared/components/job-card/job-card';
import { JobFiltersComponent } from '../../shared/components/job-filters/job-filters';
import { jobDate, jobRequestError } from '../../shared/utils/job-presentation';
type View = 'discover' | 'saved' | 'applied' | 'hidden';
interface LibraryRow {
  action: JobActionRecord;
  job: Job | null;
}
@Component({
  selector: 'app-jobs',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule, JobCardComponent, JobFiltersComponent],
  templateUrl: './jobs.component.html',
  styleUrl: './jobs.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobsComponent implements OnInit, OnDestroy {
  readonly tabs: { id: View; label: string }[] = [
    { id: 'discover', label: 'Discover' },
    { id: 'saved', label: 'Saved jobs' },
    { id: 'applied', label: 'Application tracker' },
    { id: 'hidden', label: 'Hidden' },
  ];
  view: View = 'discover';
  activeFilters: JobFilters = { ...DEFAULT_JOB_FILTERS };
  pendingFilters: JobFilters = { ...DEFAULT_JOB_FILTERS };
  jobs: Job[] = [];
  rows: LibraryRow[] = [];
  response: JobsResponse | null = null;
  page = 1;
  totalPages = 1;
  total = 0;
  hasMore = false;
  isLoading = false;
  filtersOpen = false;
  errorMessage = '';
  notice = '';
  importing = false;
  retryAt = 0;
  now = Date.now();
  offline = !navigator.onLine;
  sort = 'match';
  readonly date = jobDate;
  private request = new Subscription();
  private readonly subscriptions = new Subscription();
  private token = 0;
  private contextOwner = '';
  private lastLoadedAt = 0;
  private timer: ReturnType<typeof setInterval> | undefined;
  constructor(
    readonly actions: JobActionsService,
    private readonly jobsApi: JobService,
    private readonly auth: AuthService,
    readonly profile: CareerProfileService,
    private readonly route: ActivatedRoute,
    private readonly cdr: ChangeDetectorRef,
  ) {}
  get displayedJobs(): Job[] {
    const visible = this.jobs.filter((job) => !this.actions.state(job.id).hidden);
    if (this.sort === 'newest')
      return [...visible].sort(
        (a, b) => (Date.parse(b.postedDate) || 0) - (Date.parse(a.postedDate) || 0),
      );
    if (this.sort === 'company')
      return [...visible].sort((a, b) => a.company.localeCompare(b.company));
    return visible;
  }
  get legacyCount(): number {
    return Object.keys(this.actions.legacy()).length;
  }
  get coolingDown(): boolean {
    return this.now < this.retryAt;
  }
  get actionBlocked(): boolean {
    return this.offline || this.coolingDown || this.now < this.actions.retryAt;
  }
  ngOnInit(): void {
    const tab = this.route.snapshot.queryParamMap.get('view');
    if (this.tabs.some((item) => item.id === tab)) this.view = tab as View;
    this.subscriptions.add(
      combineLatest([this.auth.currentUser$, this.profile.careerProfile$])
        .pipe(
          map(([user, profile]) =>
            JSON.stringify([
              user?._id || user?.['id'],
              user?.activeGithubUsername,
              user?.activeCareerStack || user?.careerStack,
              user?.activeExperienceLevel || user?.experienceLevel,
              profile,
              user?.['activeResumeFileId'] || user?.['defaultResumeFileId'],
              user?.['updatedAt'],
            ]),
          ),
          distinctUntilChanged(),
        )
        .subscribe(() => {
          const user = this.auth.getCurrentUser();
          const owner = String(user?._id || user?.['id'] || '');
          if (owner !== this.contextOwner) this.retryAt = 0;
          this.contextOwner = owner;
          this.jobs = [];
          this.rows = [];
          this.response = null;
          this.notice = '';
          if (!this.coolingDown) this.errorMessage = '';
          this.jobsApi.clearCache();
          if (this.auth.getCurrentUser()) this.load(1);
          else {
            this.request.unsubscribe();
            this.isLoading = false;
            this.cdr.markForCheck();
          }
        }),
    );
    this.subscriptions.add(this.actions.changes$.subscribe(() => this.cdr.markForCheck()));
    this.timer = setInterval(() => {
      this.now = Date.now();
      this.cdr.markForCheck();
    }, 1000);
  }
  ngOnDestroy(): void {
    this.request.unsubscribe();
    this.subscriptions.unsubscribe();
    if (this.timer) clearInterval(this.timer);
  }
  @HostListener('window:focus') onFocus(): void {
    if (!this.isLoading && Date.now() - this.lastLoadedAt > 30000) this.revalidate();
  }
  @HostListener('window:online') onOnline(): void {
    this.offline = false;
    this.revalidate();
  }
  @HostListener('window:offline') onOffline(): void {
    this.offline = true;
    this.cdr.markForCheck();
  }
  setView(view: View): void {
    if (this.view === view) return;
    this.view = view;
    this.jobs = [];
    this.rows = [];
    this.errorMessage = '';
    this.notice = '';
    this.load(1);
  }
  search(value: string): void {
    this.pendingFilters = { ...this.pendingFilters, skills: value };
  }
  stage(filters: JobFilters): void {
    this.pendingFilters = normalizeJobFilters(filters);
  }
  applyFilters(): void {
    if (this.coolingDown || this.offline) return;
    this.activeFilters = normalizeJobFilters(this.pendingFilters);
    this.filtersOpen = false;
    this.jobs = [];
    this.load(1);
  }
  resetFilters(): void {
    this.pendingFilters = { ...DEFAULT_JOB_FILTERS };
    this.applyFilters();
  }
  revalidate(): void {
    if (this.coolingDown || this.offline || !this.auth.getCurrentUser()) return;
    this.jobsApi.clearCache();
    this.load(this.page);
  }
  load(page: number): void {
    if (this.coolingDown || this.offline) return;
    this.request.unsubscribe();
    this.request = new Subscription();
    const token = ++this.token;
    this.isLoading = true;
    this.errorMessage = '';
    this.cdr.markForCheck();
    if (this.view === 'discover') {
      this.request.add(
        this.jobsApi
          .getJobs(this.activeFilters, page, 10)
          .pipe(
            finalize(() => {
              if (token === this.token) {
                this.isLoading = false;
                this.cdr.markForCheck();
              }
            }),
          )
          .subscribe({
            next: (response) => {
              if (token !== this.token) return;
              this.jobs = response.jobs;
              this.actions.seed(this.jobs);
              this.response = response;
              this.page = response.page;
              this.totalPages = response.totalPages;
              this.total = response.total;
              this.hasMore = response.hasMore;
              this.lastLoadedAt = Date.now();
            },
            error: (error) => this.failed(error),
          }),
      );
    } else {
      this.request.add(
        this.actions
          .list(this.view, page, 10)
          .pipe(
            switchMap((response) => {
              this.page = response.page;
              this.hasMore = response.hasMore;
              return from(response.actions).pipe(
                mergeMap(
                  (action, index) =>
                    (action.hidden
                      ? of(null)
                      : this.jobsApi
                          .getJobById(action.jobId)
                          .pipe(
                            catchError((error) =>
                              error.status === 404 ? of(null) : throwError(() => error),
                            ),
                          )
                    ).pipe(map((job) => ({ action, job, index }))),
                  3,
                ),
                toArray(),
                map((rows) => rows.sort((a, b) => a.index - b.index)),
              );
            }),
            finalize(() => {
              if (token === this.token) {
                this.isLoading = false;
                this.cdr.markForCheck();
              }
            }),
          )
          .subscribe({
            next: (rows) => {
              if (token === this.token) {
                this.rows = rows;
                this.lastLoadedAt = Date.now();
              }
            },
            error: (error) => this.failed(error),
          }),
      );
    }
  }
  private failed(error: Parameters<typeof jobRequestError>[0]): void {
    const failure = jobRequestError(error);
    this.errorMessage = failure.message;
    this.retryAt = failure.retryAt;
    this.cdr.markForCheck();
  }
  mutate(id: string, field: JobActionField): void {
    if (this.actionBlocked) return;
    this.notice = '';
    this.errorMessage = '';
    const value = !this.actions.state(id)[field];
    this.subscriptions.add(
      this.actions.update(id, { [field]: value }).subscribe({
        next: () => {
          this.notice =
            field === 'applied'
              ? value
                ? 'Marked applied in your tracker. No application was submitted.'
                : 'Applied mark removed.'
              : 'Activity synced to your account.';
          if (field === 'hidden' || this.view !== 'discover')
            this.load(field === 'hidden' ? 1 : this.page);
        },
        error: (error) => this.failed(error),
      }),
    );
  }
  async importActivity(): Promise<void> {
    if (this.importing || this.actionBlocked || this.now < this.actions.migrationRetryAt) return;
    this.importing = true;
    try {
      const result = await this.actions.importLegacy();
      this.notice =
        result.imported +
        ' imported; ' +
        result.reconciled +
        ' reconciled with account history. ' +
        result.unavailable +
        ' unavailable listings kept in this browser.';
      this.revalidate();
    } catch (error) {
      if (error instanceof Error && !('status' in error)) this.errorMessage = error.message;
      else this.failed(error as Parameters<typeof jobRequestError>[0]);
    } finally {
      this.importing = false;
      this.cdr.markForCheck();
    }
  }
}
