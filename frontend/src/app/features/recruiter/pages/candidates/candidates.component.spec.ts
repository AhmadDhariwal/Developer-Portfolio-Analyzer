import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../../../shared/services/auth.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';
import { RecruiterModule } from '../../recruiter.module';
import { DEFAULT_CANDIDATE_FILTERS } from '../../models/recruiter.model';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';
import { CandidatesComponent } from './candidates.component';

describe('Candidates discovery pagination and scope', () => {
  let fixture: ComponentFixture<CandidatesComponent>;
  let component: CandidatesComponent;
  let requests: Subject<any>[];
  let list: ReturnType<typeof vi.fn>;
  let users: BehaviorSubject<any>;
  let tenants: BehaviorSubject<any>;

  const page = (number = 1, name = 'Visible developer') => ({
    candidates: [{ id: `candidate-${number}`, name, readinessScore: 80 }],
    filters: { stacks: ['Backend'], locations: ['Remote'] },
    meta: {
      page: number,
      totalPages: 3,
      total: 25,
      limit: 12,
      hasNext: number < 3,
      nextCursor: number < 3 ? `cursor-for-${number + 1}` : null,
      organizationId: 'org-1',
      recruiterId: 'user-1',
    },
  });

  beforeEach(async () => {
    requests = [];
    users = new BehaviorSubject({ _id: 'user-1', role: 'recruiter', organizationId: 'org-1' });
    tenants = new BehaviorSubject({ organizationId: 'org-1' });
    list = vi.fn(() => {
      const response = new Subject<any>();
      requests.push(response);
      return response;
    });
    await TestBed.configureTestingModule({
      imports: [RecruiterModule],
      providers: [
        provideRouter([]),
        { provide: CandidateService, useValue: { listCandidates: list } },
        { provide: RecruiterMatchService, useValue: { addToShortlist: () => of({}) } },
        { provide: AuthService, useValue: { currentUser$: users } },
        {
          provide: TenantContextService,
          useValue: {
            state$: tenants,
            get snapshot() {
              return tenants.value;
            },
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(CandidatesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('shows loading, exact totals, page result counts and cursor continuation while retaining filters', () => {
    expect(component.loading).toBe(true);
    requests[0].next(page());
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('25 matching profiles');
    expect(fixture.nativeElement.textContent).toContain('1 result on this page');
    component.goToPage(2);
    expect(list).toHaveBeenLastCalledWith({
      ...DEFAULT_CANDIDATE_FILTERS,
      page: 2,
      cursor: 'cursor-for-2',
    });
    expect(component.candidates).toEqual([]);
    requests[1].next(page(2));
    component.applyFilters({ ...component.filters, search: 'Node', skills: 'Node.js' });
    expect(list).toHaveBeenLastCalledWith({
      ...DEFAULT_CANDIDATE_FILTERS,
      search: 'Node',
      skills: 'Node.js',
      page: 1,
    });
  });

  it('discards superseded navigation and filter responses', () => {
    requests[0].next(page());
    component.goToPage(2);
    component.goToPage(3);
    requests[1].next(page(2, 'Stale page'));
    expect(component.candidates).toEqual([]);
    requests[2].next(page(3, 'Current page'));
    expect(component.candidates[0].name).toBe('Current page');
    component.applyFilters({ ...component.filters, search: 'Changed' });
    requests[2].next(page(3, 'Stale filter'));
    expect(component.candidates).toEqual([]);
  });

  it('clears previous results and totals on failure, keeps filters for retry, and distinguishes empty success', () => {
    requests[0].next(page());
    component.applyFilters({ ...component.filters, search: 'Specific' });
    requests[1].error({ status: 503, error: { message: 'Search timed out' } });
    fixture.detectChanges();
    expect(component.meta.total).toBe(0);
    expect(component.candidates).toEqual([]);
    expect(fixture.nativeElement.textContent).toContain('Search timed out');
    expect(fixture.nativeElement.textContent).toContain('Results unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('No matching candidates found');
    component.loadCandidates();
    expect(list.mock.lastCall?.[0].search).toBe('Specific');
    requests[2].next({ candidates: [], meta: { total: 0, page: 1, totalPages: 1 } });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No matching candidates found');
  });

  it('drops results, comparison names and cursors on account switching and signout', () => {
    requests[0].next(page());
    component.toggleCompare(component.candidates[0]);
    component.goToPage(2);
    users.next({ _id: 'user-2', role: 'recruiter', organizationId: 'org-1' });
    expect(component.selectedCompareItems).toEqual([]);
    expect(component.candidates).toEqual([]);
    expect(list.mock.lastCall?.[0]).toEqual(DEFAULT_CANDIDATE_FILTERS);
    requests[1].next(page(2, 'Previous user'));
    expect(component.candidates).toEqual([]);
    users.next(null);
    const calls = list.mock.calls.length;
    requests[2].next(page(1, 'Signed-out response'));
    expect(component.candidates).toEqual([]);
    expect(component.loading).toBe(false);
    expect(list.mock.calls.length).toBe(calls);
  });

  it('rejects a response scoped to another organization even if the server request completed', () => {
    requests[0].next(page());
    tenants.next({ organizationId: 'org-2' });
    expect(component.candidates).toEqual([]);
    requests[1].next(page());
    expect(component.candidates).toEqual([]);
    expect(component.meta.total).toBe(0);
    expect(component.error).toContain('context changed');
  });
  it('restarts an expired cursor without discarding applied search filters', () => {
    requests[0].next(page());
    component.applyFilters({ ...DEFAULT_CANDIDATE_FILTERS, search: 'Node' });
    requests[1].next(page());
    component.goToPage(2);
    requests[2].error({
      status: 400,
      error: { code: 'CANDIDATE_CURSOR_INVALID', message: 'Cursor expired' },
    });
    component.retryCandidates();
    expect(list.mock.lastCall?.[0]).toEqual({ ...DEFAULT_CANDIDATE_FILTERS, search: 'Node' });
    expect(component.filters.page).toBe(1);
    expect(component.error).toBe('');
  });

  it('keeps successful discovery counts visible when a shortlist action fails', () => {
    requests[0].next(page());
    vi.spyOn(TestBed.inject(RecruiterMatchService), 'addToShortlist').mockReturnValue(
      throwError(() => ({ error: { message: 'Shortlist permission changed' } })),
    );
    component.shortlist(component.candidates[0]);
    fixture.detectChanges();
    expect(component.error).toBe('');
    expect(fixture.nativeElement.textContent).toContain('Shortlist permission changed');
    expect(fixture.nativeElement.textContent).toContain('25 matching profiles');
    expect(fixture.nativeElement.textContent).not.toContain('Results unavailable');
  });

  it('treats malformed totals as an error rather than inventing a successful count', () => {
    requests[0].next({ candidates: [{ id: 'candidate' }] });
    fixture.detectChanges();
    expect(component.candidates).toEqual([]);
    expect(component.meta.total).toBe(0);
    expect(component.error).toContain('Unexpected candidate response');
    expect(fixture.nativeElement.textContent).not.toContain('No matching candidates found');
  });
});
