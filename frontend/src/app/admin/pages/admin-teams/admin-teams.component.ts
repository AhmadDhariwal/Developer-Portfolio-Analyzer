import { Component, DestroyRef, OnInit, inject, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';

import { AdminConsoleService, ConsoleTeam } from '../admin-console/admin-console.service';
import { AdminHiringService, AdminRecruiter } from '../../services/admin-hiring.service';
import { SharedLoaderComponent } from '../../../shared/components/loader/loader.component';
import { SharedMessageComponent } from '../../../shared/components/message/message.component';
import { RecruiterSharedModule } from '../../../supervisors/recruiter-shared/recruiter-shared.module';

type SortOption = {
  label: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
};

@Component({
  selector: 'app-admin-teams-page',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SharedLoaderComponent,
    SharedMessageComponent,
    RecruiterSharedModule
  ],
  templateUrl: './admin-teams.component.html',
  styleUrls: ['./admin-teams.component.scss']
})
export class AdminTeamsPageComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly searchInput$ = new Subject<string>();

  private readonly initialQuery = {
    page: 1,
    limit: 10,
    search: '',
    status: 'all',
    recruiterId: '',
    sortBy: 'score',
    sortOrder: 'desc'
  };

  protected readonly queryState$ = new BehaviorSubject<any>(this.initialQuery);

  // Filter Dropdowns
  recruiters: AdminRecruiter[] = [];
  statusOptions = [
    { label: 'All Statuses', value: 'all' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' }
  ];
  sortOptions: SortOption[] = [
    { label: 'Highest Team Score', sortBy: 'score', sortOrder: 'desc' },
    { label: 'Most Recruiters', sortBy: 'recruiters', sortOrder: 'desc' },
    { label: 'Most Jobs', sortBy: 'jobs', sortOrder: 'desc' },
    { label: 'Newest Teams', sortBy: 'newest', sortOrder: 'desc' }
  ];

  // Component State
  loading = false;
  saving = false;
  message = '';
  messageType: 'success' | 'error' = 'success';
  viewMode: 'grid' | 'table' = 'grid';

  // Filter state
  searchInput = '';
  statusFilter = 'all';
  recruiterFilter = '';

  // Teams list data
  teams: any[] = [];
  page = 1;
  pageSize = 10;
  total = 0;
  totalPages = 1;
  hasMore = false;

  // Drawer / Details State
  selectedTeam: any | null = null;
  drawerActiveTab: 'overview' | 'recruiters' | 'jobs' | 'performance' | 'activity' = 'overview';
  newRecruiterId = '';

  // Dialog State (Edit / Create)
  showEditModal = false;
  showCreateModal = false;
  modalTeamForm = {
    _id: '',
    name: '',
    slug: '',
    description: ''
  };

  // Confirm Delete state
  showConfirmDelete = false;
  teamToDelete: any = null;

  // Analytics Widgets data
  topTeams: any[] = [];
  recruiterDistribution: any[] = [];
  teamActivityTrend: any[] = [];

  constructor(
    private readonly consoleService: AdminConsoleService,
    private readonly hiringService: AdminHiringService
  ) {}

  ngOnInit(): void {
    // 1. Set up search input debouncing
    this.searchInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((search) => {
        this.patchQuery({ search, page: 1 });
      });

    // 2. Listen to query state changes & load teams
    this.queryState$
      .pipe(
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        tap(() => {
          this.loading = true;
          this.message = '';
        }),
        switchMap((query) =>
          this.consoleService.getTeamsPaginated(query).pipe(
            catchError((err) => {
              this.loading = false;
              this.message = 'Failed to load teams.';
              this.messageType = 'error';
              return of({
                teams: [],
                page: query.page,
                limit: query.limit,
                total: 0,
                totalPages: 1,
                hasMore: false
              });
            })
          )
        ),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((response: any) => {
        this.teams = response.teams || [];
        this.page = response.page || 1;
        this.pageSize = response.limit || 10;
        this.total = response.total || 0;
        this.totalPages = response.totalPages || 1;
        this.hasMore = response.hasMore || false;
        this.loading = false;

        // Keep drawer selected team in sync if it's open
        if (this.selectedTeam) {
          const updated = this.teams.find((t) => t._id === this.selectedTeam._id);
          if (updated) {
            this.selectedTeam = updated;
          }
        }
        this.cdr.markForCheck();
      });

    // 3. Load other context details (recruiters, analytics for widgets)
    this.loadRecruiters();
    this.loadAnalyticsData();
  }

  loadRecruiters(): void {
    this.hiringService.getRecruiters().subscribe({
      next: (res) => {
        this.recruiters = res || [];
        this.cdr.markForCheck();
      },
      error: () => {
        this.recruiters = [];
      }
    });
  }

  loadAnalyticsData(): void {
    // Fetch performance metrics for all teams to compute widgets
    this.consoleService.getPerformance().subscribe({
      next: (res) => {
        const metrics = res?.teamMetrics || [];
        
        // Compact Widget 1: Top 5 Teams
        this.topTeams = [...metrics]
          .sort((a, b) => b.performanceScore - a.performanceScore)
          .slice(0, 5);

        // Compact Widget 2: Recruiter Distribution
        this.recruiterDistribution = metrics.map((m: any) => ({
          name: m.name,
          count: m.recruiterCount || 0
        })).sort((a: any, b: any) => b.count - a.count).slice(0, 6);

        // Compact Widget 3: Activity Trends
        // Aggregate activity per team
        this.teamActivityTrend = metrics.map((m: any) => ({
          name: m.name,
          activityCount: m.activityCount || 0,
          health: m.health
        })).sort((a: any, b: any) => b.activityCount - a.activityCount).slice(0, 5);

        this.cdr.markForCheck();
      },
      error: (err) => {
        console.error('Failed to load performance analytics for widgets', err);
      }
    });
  }

  // Query state helpers
  get activeSort(): SortOption {
    const q = this.queryState$.value;
    return this.sortOptions.find((o) => o.sortBy === q.sortBy && o.sortOrder === q.sortOrder) || this.sortOptions[0];
  }

  get rangeStart(): number {
    return this.total === 0 ? 0 : (this.page - 1) * this.pageSize + 1;
  }

  get rangeEnd(): number {
    return Math.min(this.page * this.pageSize, this.total);
  }

  get pageItems(): Array<number | string> {
    if (this.totalPages <= 7) {
      return Array.from({ length: this.totalPages }, (_, index) => index + 1);
    }
    const pages = new Set<number>([1, this.totalPages, this.page - 1, this.page, this.page + 1]);
    const ordered = Array.from(pages).filter((v) => v >= 1 && v <= this.totalPages).sort((a, b) => a - b);
    const items: Array<number | string> = [];
    ordered.forEach((value, index) => {
      const prev = ordered[index - 1];
      if (index > 0 && prev !== undefined && value - prev > 1) {
        items.push(`ellipsis-${prev}-${value}`);
      }
      items.push(value);
    });
    return items;
  }

  private patchQuery(patch: any): void {
    const nextQuery = {
      ...this.queryState$.value,
      ...patch
    };
    this.queryState$.next(nextQuery);
  }

  // Filter Event Handlers
  onSearchChange(value: string): void {
    this.searchInput = value;
    this.searchInput$.next(value);
  }

  onStatusChange(value: string): void {
    this.statusFilter = value;
    this.patchQuery({ status: value, page: 1 });
  }

  onRecruiterChange(value: string): void {
    this.recruiterFilter = value;
    this.patchQuery({ recruiterId: value, page: 1 });
  }

  onSortChange(value: string): void {
    const option = this.sortOptions.find((o) => `${o.sortBy}:${o.sortOrder}` === value) || this.sortOptions[0];
    this.patchQuery({ sortBy: option.sortBy, sortOrder: option.sortOrder, page: 1 });
  }

  goToPage(page: number): void {
    if (page < 1 || page > this.totalPages || page === this.page) return;
    this.patchQuery({ page });
  }

  resetFilters(): void {
    this.searchInput = '';
    this.statusFilter = 'all';
    this.recruiterFilter = '';
    this.patchQuery({
      page: 1,
      limit: 10,
      search: '',
      status: 'all',
      recruiterId: '',
      sortBy: 'score',
      sortOrder: 'desc'
    });
  }

  // Detail Drawer Actions
  viewDetails(team: any): void {
    this.selectedTeam = team;
    this.drawerActiveTab = 'overview';
    this.newRecruiterId = '';
    this.cdr.markForCheck();
  }

  closeDrawer(): void {
    this.selectedTeam = null;
    this.cdr.markForCheck();
  }

  // Edit / Create Modals
  openCreateModal(): void {
    this.modalTeamForm = { _id: '', name: '', slug: '', description: '' };
    this.showCreateModal = true;
    this.cdr.markForCheck();
  }

  openEditModal(team: any): void {
    this.modalTeamForm = {
      _id: team._id,
      name: team.name,
      slug: team.slug,
      description: team.description
    };
    this.showEditModal = true;
    this.cdr.markForCheck();
  }

  closeModals(): void {
    this.showCreateModal = false;
    this.showEditModal = false;
    this.cdr.markForCheck();
  }

  createTeam(): void {
    if (!this.modalTeamForm.name) {
      this.showFeedback('Name is required.', 'error');
      return;
    }
    this.saving = true;
    this.consoleService.createTeam(this.modalTeamForm).subscribe({
      next: () => {
        this.showFeedback('Team created successfully.', 'success');
        this.closeModals();
        this.patchQuery({ page: 1 });
        this.loadAnalyticsData();
        this.saving = false;
      },
      error: (err) => {
        this.showFeedback(err?.error?.message || 'Failed to create team.', 'error');
        this.saving = false;
        this.cdr.markForCheck();
      }
    });
  }

  saveTeam(): void {
    if (!this.modalTeamForm.name) {
      this.showFeedback('Name is required.', 'error');
      return;
    }
    this.saving = true;
    this.consoleService.updateTeam(this.modalTeamForm._id, this.modalTeamForm).subscribe({
      next: (res) => {
        this.showFeedback('Team updated successfully.', 'success');
        this.closeModals();
        
        // Refresh paginated grid
        this.patchQuery({});
        this.loadAnalyticsData();
        this.saving = false;
      },
      error: (err) => {
        this.showFeedback(err?.error?.message || 'Failed to update team.', 'error');
        this.saving = false;
        this.cdr.markForCheck();
      }
    });
  }

  toggleActive(team: any, event?: Event): void {
    if (event) {
      event.stopPropagation();
    }
    this.loading = true;
    this.consoleService.setTeamActive(team._id, !team.isActive).subscribe({
      next: () => {
        this.showFeedback(team.isActive ? 'Team deactivated.' : 'Team activated.', 'success');
        this.patchQuery({});
        this.loadAnalyticsData();
      },
      error: (err) => {
        this.showFeedback(err?.error?.message || 'Failed to toggle status.', 'error');
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  confirmDelete(team: any, event: Event): void {
    event.stopPropagation();
    this.teamToDelete = team;
    this.showConfirmDelete = true;
    this.cdr.markForCheck();
  }

  cancelDelete(): void {
    this.teamToDelete = null;
    this.showConfirmDelete = false;
    this.cdr.markForCheck();
  }

  deleteTeam(): void {
    if (!this.teamToDelete) return;
    this.loading = true;
    this.showConfirmDelete = false;
    this.consoleService.deleteTeam(this.teamToDelete._id).subscribe({
      next: () => {
        this.showFeedback('Team deleted successfully.', 'success');
        this.teamToDelete = null;
        if (this.selectedTeam && this.selectedTeam._id === this.teamToDelete?._id) {
          this.selectedTeam = null;
        }
        this.patchQuery({ page: 1 });
        this.loadAnalyticsData();
      },
      error: (err) => {
        this.showFeedback(err?.error?.message || 'Failed to delete team.', 'error');
        this.loading = false;
        this.cdr.markForCheck();
      }
    });
  }

  // Recruiter Assignment inside drawer
  assignRecruiter(): void {
    if (!this.selectedTeam || !this.newRecruiterId) return;
    this.saving = true;
    this.consoleService.assignRecruiterToTeam(this.selectedTeam._id, this.newRecruiterId).subscribe({
      next: (res) => {
        this.showFeedback('Recruiter assigned successfully.', 'success');
        this.newRecruiterId = '';
        this.selectedTeam = res.team;
        this.patchQuery({});
        this.loadAnalyticsData();
        this.saving = false;
      },
      error: (err) => {
        this.showFeedback(err?.error?.message || 'Failed to assign recruiter.', 'error');
        this.saving = false;
        this.cdr.markForCheck();
      }
    });
  }

  removeRecruiter(recruiterId: string): void {
    if (!this.selectedTeam) return;
    this.saving = true;
    this.consoleService.removeRecruiterFromTeam(this.selectedTeam._id, recruiterId).subscribe({
      next: (res) => {
        this.showFeedback('Recruiter removed from team.', 'success');
        this.selectedTeam = res.team;
        this.patchQuery({});
        this.loadAnalyticsData();
        this.saving = false;
      },
      error: (err) => {
        this.showFeedback(err?.error?.message || 'Failed to remove recruiter.', 'error');
        this.saving = false;
        this.cdr.markForCheck();
      }
    });
  }

  // Helpers
  showFeedback(text: string, type: 'success' | 'error'): void {
    this.message = text;
    this.messageType = type;
    this.cdr.markForCheck();
    setTimeout(() => {
      this.message = '';
      this.cdr.markForCheck();
    }, 4000);
  }

  getAvailableRecruitersForAssignment(): AdminRecruiter[] {
    if (!this.selectedTeam || !this.recruiters) return [];
    return this.recruiters.filter(
      (r) => !this.selectedTeam.members.some((m: any) => String(m._id) === String(r._id))
    );
  }

  teamTone(score?: number): 'high' | 'mid' | 'low' {
    const val = score || 0;
    if (val >= 70) return 'high';
    if (val >= 30) return 'mid';
    return 'low';
  }

  getHealthClass(health: string): string {
    switch (health) {
      case 'Healthy':
        return 'health-pill--healthy';
      case 'Warning':
        return 'health-pill--warning';
      case 'Critical':
      default:
        return 'health-pill--critical';
    }
  }

  trackByTeamId(_: number, team: any): string {
    return team._id;
  }

  trackByPageItem(index: number, item: number | string): string | number {
    return typeof item === 'number' ? item : `${item}-${index}`;
  }
}
