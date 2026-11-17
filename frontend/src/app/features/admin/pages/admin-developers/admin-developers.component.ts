import { Component, DestroyRef, OnInit, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { catchError, debounceTime, distinctUntilChanged, switchMap, tap } from 'rxjs/operators';

import {
  AdminDeveloper,
  AdminDeveloperPage,
  AdminDeveloperQuery,
  AdminHiringService
} from '../../services/admin-hiring.service';

type SortOption = {
  label: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
};

@Component({
  selector: 'app-admin-developers-page',
  standalone: false,
  templateUrl: './admin-developers.component.html',
  styleUrls: ['./admin-developers.component.scss']
})
export class AdminDevelopersPageComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly searchInput$ = new Subject<string>();
  private readonly initialQuery: AdminDeveloperQuery = {
    page: 1,
    limit: 10,
    search: '',
    stack: '',
    experienceLevel: '',
    minScore: null,
    sortBy: 'lastAnalyzedAt',
    sortOrder: 'desc'
  };
  private readonly queryState$ = new BehaviorSubject<AdminDeveloperQuery>(this.initialQuery);

  readonly stackOptions = ['Frontend', 'Backend', 'Full Stack', 'AI/ML'];
  readonly experienceOptions = ['Student', 'Intern', '0-1 years', '1-2 years', '2-3 years', '3-5 years', '5+ years'];
  readonly minScoreOptions = [0, 40, 60, 70, 80, 90];
  readonly sortOptions: SortOption[] = [
    { label: 'Recently analyzed', sortBy: 'lastAnalyzedAt', sortOrder: 'desc' },
    { label: 'Highest readiness', sortBy: 'readinessScore', sortOrder: 'desc' },
    { label: 'Highest GitHub score', sortBy: 'githubScore', sortOrder: 'desc' },
    { label: 'Highest resume score', sortBy: 'resumeScore', sortOrder: 'desc' },
    { label: 'Most projects', sortBy: 'projectsCount', sortOrder: 'desc' },
    { label: 'Newest profiles', sortBy: 'createdAt', sortOrder: 'desc' },
    { label: 'Name A-Z', sortBy: 'name', sortOrder: 'asc' }
  ];

  loading = false;
  message = '';
  developers: AdminDeveloper[] = [];
  selectedDeveloper: AdminDeveloper | null = null;

  searchInput = '';
  stackFilter = '';
  experienceLevelFilter = '';
  minScoreFilter = '';
  sortValue = 'lastAnalyzedAt:desc';

  page = 1;
  pageSize = 10;
  total = 0;
  totalPages = 1;
  hasMore = false;

  constructor(private readonly adminService: AdminHiringService) {}

  ngOnInit(): void {
    this.searchInput$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((search) => {
        this.patchQuery({ search, page: 1 });
      });

    this.queryState$
      .pipe(
        distinctUntilChanged((prev, curr) => JSON.stringify(prev) === JSON.stringify(curr)),
        tap(() => {
          this.loading = true;
          this.message = '';
        }),
        switchMap((query) =>
          this.adminService.getDevelopers(query).pipe(
            catchError(() => {
              this.loading = false;
              this.message = 'Failed to load public developers.';
              return of<AdminDeveloperPage>({
                developers: [],
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
        this.developers = response.developers || [];
        this.page = response.page || 1;
        this.pageSize = response.limit || 10;
        this.total = response.total || 0;
        this.totalPages = response.totalPages || 1;
        this.hasMore = response.hasMore || false;
        this.loading = false;

        if (this.selectedDeveloper) {
          this.selectedDeveloper = this.developers.find((developer) => developer._id === this.selectedDeveloper?._id) || null;
        }
      });
  }

  get activeSort(): SortOption {
    return this.sortOptions.find((option) => `${option.sortBy}:${option.sortOrder}` === this.sortValue) || this.sortOptions[0];
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
    const ordered = Array.from(pages).filter((value) => value >= 1 && value <= this.totalPages).sort((a, b) => a - b);
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

  trackByDeveloperId(_: number, developer: AdminDeveloper): string {
    return developer._id;
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

  onExperienceLevelChange(value: string): void {
    this.experienceLevelFilter = value;
    this.patchQuery({ experienceLevel: value, page: 1 });
  }

  onMinScoreChange(value: string): void {
    this.minScoreFilter = value;
    this.patchQuery({ minScore: value === '' ? null : Number(value), page: 1 });
  }

  onSortChange(value: string): void {
    this.sortValue = value;
    const [sortBy, sortOrder] = value.split(':');
    this.patchQuery({
      sortBy,
      sortOrder: sortOrder === 'asc' ? 'asc' : 'desc',
      page: 1
    });
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
    this.experienceLevelFilter = '';
    this.minScoreFilter = '';
    this.sortValue = 'lastAnalyzedAt:desc';
    this.patchQuery({ ...this.initialQuery });
  }

  openDeveloperDetails(developer: AdminDeveloper): void {
    this.selectedDeveloper = developer;
  }

  closeDeveloperDetails(): void {
    this.selectedDeveloper = null;
  }

  profileTitle(developer: AdminDeveloper): string {
    return developer.headline || developer.jobTitle || 'Developer';
  }

  portfolioLink(developer: AdminDeveloper): string | null {
    if (developer.publicProfileSlug) {
      return `/p/${developer.publicProfileSlug}`;
    }

    return developer.website || null;
  }

  scoreValue(value?: number): number {
    return Math.round(Number(value || 0));
  }

  scoreTone(value?: number): 'high' | 'mid' | 'low' {
    const score = this.scoreValue(value);
    if (score >= 80) return 'high';
    if (score >= 60) return 'mid';
    return 'low';
  }

  developerInitial(developer: AdminDeveloper): string {
    return String(developer.name || '?').trim().charAt(0).toUpperCase() || '?';
  }

  hasPrimaryResults(): boolean {
    return !this.loading && this.developers.length > 0;
  }

  private patchQuery(patch: AdminDeveloperQuery): void {
    const nextQuery = {
      ...this.queryState$.value,
      ...patch
    };

    if (JSON.stringify(nextQuery) === JSON.stringify(this.queryState$.value)) {
      return;
    }

    this.queryState$.next(nextQuery);
  }
}
