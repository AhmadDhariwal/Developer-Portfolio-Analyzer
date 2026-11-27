import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors, HttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { BehaviorSubject } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import { TenantContextService } from './tenant-context.service';
import { OrganizationPolicyState } from './organization-policy-state.service';
import { OrganizationPolicyNoticeComponent } from '../components/organization-policy-notice/organization-policy-notice.component';
import { capabilityFixture } from '../testing/organization-policy-state.fixture';
import { organizationPolicyInterceptor } from '../../core/interceptors/organization-policy.interceptor';
import { environment } from '../../../environments/environment';

describe('OrganizationPolicyState request and identity boundaries', () => {
  let user: BehaviorSubject<any>;
  let tenant: BehaviorSubject<any>;
  let http: HttpTestingController;
  let state: OrganizationPolicyState;
  const endpoint = `${environment.apiBaseUrl}/recruiter-hub/capabilities`;
  beforeEach(() => {
    user = new BehaviorSubject({
      _id: 'r1',
      role: 'recruiter',
      organizationId: 'org-a',
      sessionRevision: 0,
    });
    tenant = new BehaviorSubject({ organizationId: 'org-a' });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([organizationPolicyInterceptor])),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: { currentUser$: user } },
        { provide: TenantContextService, useValue: { state$: tenant } },
      ],
    });
    state = TestBed.inject(OrganizationPolicyState);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it('deduplicates simultaneous and cached requests without polling or per-row requests', () => {
    for (let index = 0; index < 20; index++) state.refresh().subscribe();
    http.expectOne(endpoint).flush(capabilityFixture());
    state.refresh().subscribe();
    http.expectNone(endpoint);
    expect(state.allowed('candidateMatching')).toBe(true);
    state.refresh(true).subscribe();
    http.expectOne(endpoint).flush(capabilityFixture(['candidateMatching'], 1));
    expect(state.allowed('candidateMatching')).toBe(false);
  });
  it('discards late account/organization responses and clears on logout, even for a later return to the same account', () => {
    state.refresh().subscribe();
    const old = http.expectOne(endpoint);
    user.next(null);
    expect(state.value()).toBeNull();
    expect(state.allowed('candidateMatching')).toBe(false);
    user.next({ _id: 'r1', role: 'recruiter', organizationId: 'org-b', sessionRevision: 1 });
    tenant.next({ organizationId: 'org-b' });
    state.refresh().subscribe();
    const current = http.expectOne(endpoint);
    old.flush(capabilityFixture());
    expect(state.value()).toBeNull();
    current.flush(capabilityFixture(['recruiterJobCreation'], 2));
    expect(state.value()?.version).toBe(2);
    expect(state.allowed('recruiterJobCreation')).toBe(false);
  });
  it('settles loading and denies unavailable capability information', () => {
    state.refresh().subscribe();
    expect(state.loading()).toBe(true);
    http.expectOne(endpoint).flush({}, { status: 503, statusText: 'Unavailable' });
    expect(state.loading()).toBe(false);
    expect(state.canGenerate({ evaluationManage: true })).toBe(false);
    expect(state.explanation('candidateMatching')).toContain('unavailable');
  });
  it('separates matching generation, shared management and owner authority', () => {
    state.refresh().subscribe();
    http
      .expectOne(endpoint)
      .flush(capabilityFixture(['candidateMatching', 'teamManagerEvaluationManagement']));
    expect(state.canGenerate({ evaluationManage: true })).toBe(false);
    expect(state.canManagePublic({ isOwner: true, manage: true })).toBe(true);
    expect(state.canManagePublic({ isOwner: false, manage: true })).toBe(false);
    expect(
      state.publicEvaluations([{ access: { isOwner: false, manage: true } }])[0].access?.manage,
    ).toBe(false);
    expect(state.permissionError({ status: 404 }, '')).not.toContain('foreign');
  });
  it('does not allow an enabled policy to replace exact resource access', () => {
    state.refresh().subscribe();
    http.expectOne(endpoint).flush(capabilityFixture());
    expect(state.canGenerate({ evaluationManage: false })).toBe(false);
    expect(state.canManagePublic({ isOwner: false, manage: false })).toBe(false);
  });
  it('rejects late resource data after an account switch', () => {
    const client = TestBed.inject(HttpClient);
    let accepted = false;
    let denied = 0;
    client
      .get(`${environment.apiBaseUrl}/recruiter-hub/matches`)
      .subscribe({ next: () => (accepted = true), error: (error) => (denied = error.status) });
    http.expectOne(endpoint).flush(capabilityFixture());
    const resource = http.expectOne(`${environment.apiBaseUrl}/recruiter-hub/matches`);
    user.next({ _id: 'r2', role: 'recruiter', organizationId: 'org-b' });
    resource.flush({ matches: [{ private: 'must never reach the old view' }] });
    expect(accepted).toBe(false);
    expect(denied).toBe(403);
    http.expectNone(endpoint);
  });
  it('refreshes capabilities once on a denied resource without retrying the action', () => {
    const client = TestBed.inject(HttpClient);
    client
      .post(`${environment.apiBaseUrl}/recruiter-hub/matches/generate`, {})
      .subscribe({ error: () => {} });
    http.expectOne(endpoint).flush(capabilityFixture());
    http
      .expectOne(`${environment.apiBaseUrl}/recruiter-hub/matches/generate`)
      .flush({}, { status: 403, statusText: 'Forbidden' });
    http.expectOne(endpoint).flush(capabilityFixture(['candidateMatching']));
    http.expectNone(`${environment.apiBaseUrl}/recruiter-hub/matches/generate`);
  });
  it('renders delayed restriction feedback in zoneless mode without another interaction', async () => {
    const fixture = TestBed.createComponent(OrganizationPolicyNoticeComponent);
    fixture.componentRef.setInput('policy', 'candidateMatching');
    fixture.componentRef.setInput('title', 'Matching');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Checking');
    http.expectOne(endpoint).flush(capabilityFixture(['candidateMatching']));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Restricted by organization policy');
    expect(fixture.nativeElement.querySelector('button').disabled).toBe(false);
  });
});
