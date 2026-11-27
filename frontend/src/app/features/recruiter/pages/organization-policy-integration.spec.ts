import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { RecruiterModule } from '../recruiter.module';
import { RecruiterJobService } from '../services/recruiter-job.service';
import { RecruiterMatchService } from '../services/recruiter-match.service';
import { CandidateService } from '../services/candidate.service';
import { JobsComponent } from './jobs/jobs.component';
import { MatchesComponent } from './matches/matches.component';
import { ShortlistsComponent } from './shortlists/shortlists.component';
import { ComparisonComponent } from './comparison/comparison.component';
import { OrganizationPolicyState } from '../../../shared/services/organization-policy-state.service';
import {
  capabilityFixture,
  policyStateFixture,
} from '../../../shared/testing/organization-policy-state.fixture';
import { JobApplicationsService } from '../../../shared/services/job-applications.service';

async function page<T>(component: new (...args: any[]) => T) {
  const policy = policyStateFixture();
  const job = {
    _id: 'job',
    title: 'Shared job',
    role: 'Engineer',
    stack: 'Backend',
    location: 'Remote',
    status: 'open',
    version: 1,
    requiredSkills: ['TypeScript'],
    access: { isOwner: false, evaluationView: true, evaluationManage: true, edit: true },
  };
  const match = {
    _id: 'match',
    candidate: { id: 'public', name: 'Amina Public' },
    job: { _id: 'job', title: job.title },
    jobId: 'job',
    status: 'generated',
    matchScore: 70,
    access: { isOwner: false, view: true, manage: true },
  };
  const shortlist = {
    ...match,
    _id: 'shortlist',
    status: 'shortlisted',
    notes: 'Retained notes',
    version: 1,
  };
  const matching = {
    listMatches: vi.fn(() => of({ matches: [match] })),
    generateMatches: vi.fn(() => of({ matches: [] })),
    getShortlists: vi.fn(() => of({ shortlists: [shortlist] })),
    updateShortlist: vi.fn(() => of({ shortlist: { notes: 'Updated notes' } })),
    getApplicationShortlists: vi.fn(() =>
      of({
        shortlists: [
          {
            ...shortlist,
            access: {
              isOwner: true,
              manage: true,
              manageStages: true,
              manageApplicationStatus: true,
            },
            applicationId: 'private',
            application: {
              status: 'submitted',
              permittedStatuses: ['reviewing', 'rejected'],
            },
            candidate: { name: 'Private applicant' },
          },
        ],
        meta: { total: 1, pages: 1 },
      }),
    ),
    compareCandidates: vi.fn(() => of({ candidates: [] })),
  };
  await TestBed.configureTestingModule({
    imports: [RecruiterModule],
    providers: [
      provideRouter([]),
      { provide: OrganizationPolicyState, useValue: policy },
      {
        provide: RecruiterJobService,
        useValue: {
          listJobs: () => of({ jobs: [job] }),
          listEvaluationJobs: () => of({ jobs: [job] }),
        },
      },
      { provide: CandidateService, useValue: { listCandidates: () => of({ candidates: [] }) } },
      { provide: RecruiterMatchService, useValue: matching },
      { provide: JobApplicationsService, useValue: {} },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(component);
  fixture.detectChanges();
  await fixture.whenStable();
  return { fixture, policy, matching, job, match, shortlist };
}
describe('Rendered action-specific organization restrictions', () => {
  it('disables new job creation while preserving authorized browsing and existing editing', async () => {
    const { fixture, policy } = await page(JobsComponent);
    policy.value.set(capabilityFixture(['recruiterJobCreation']));
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[data-testid=toggle-job-editor]').disabled).toBe(
      true,
    );
    expect(fixture.nativeElement.textContent).toContain('Shared job');
    expect(fixture.nativeElement.textContent).toContain('Existing authorized job management');
  });
  it('separates matching generation from management of historical evaluations', async () => {
    const { fixture, policy } = await page(MatchesComponent);
    policy.value.set(capabilityFixture(['candidateMatching']));
    await fixture.whenStable();
    const buttons = [
      ...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>),
    ];
    expect(
      buttons.find((button) => button.textContent?.trim() === 'Generate Matches')!.disabled,
    ).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Amina Public');
    expect(buttons.find((button) => button.textContent?.trim() === 'Shortlist')).toBeTruthy();
  });
  it('makes non-owner shared evaluation management read-only using live policy prerequisites', async () => {
    const { fixture, policy, matching } = await page(ShortlistsComponent);
    policy.value.set(capabilityFixture(['teamManagerEvaluationManagement']));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Retained notes');
    expect(fixture.nativeElement.textContent).not.toContain('Edit Note');
    fixture.componentInstance.updateNotes({
      item: fixture.componentInstance.shortlists[0],
      notes: 'Denied local update',
    });
    expect(matching.updateShortlist).not.toHaveBeenCalled();
  });
  it('withdraws non-owner public evaluation rows after sharing is restricted', async () => {
    const { fixture, policy } = await page(ShortlistsComponent);
    policy.value.set(capabilityFixture(['sharedPublicEvaluations']));
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).not.toContain('Amina Public');
    expect(fixture.nativeElement.textContent).not.toContain('Retained notes');
  });
  it('preserves private application note and stage controls under restrictive public policies', async () => {
    const { fixture, policy } = await page(ShortlistsComponent);
    policy.value.set(
      capabilityFixture([
        'candidateMatching',
        'teamSharedJobs',
        'sharedPublicEvaluations',
        'teamManagerEvaluationManagement',
      ]),
    );
    fixture.componentInstance.setSource('applications');
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('Private applicant');
    expect(fixture.nativeElement.textContent).toContain('Edit Note');
    expect(fixture.nativeElement.textContent).toContain('Mark application reviewing');
  });
  it('keeps permitted general comparison available while preventing job-based ranking', async () => {
    const { fixture, policy, matching } = await page(ComparisonComponent);
    policy.value.set(capabilityFixture(['candidateMatching']));
    fixture.componentInstance.selectedIds = new Set(['one', 'two']);
    fixture.componentInstance.selectedJobId = 'job';
    fixture.componentInstance.loadComparison();
    expect(matching.compareCandidates).not.toHaveBeenCalled();
    fixture.componentInstance.selectedJobId = '';
    await fixture.whenStable();
    const button = [
      ...(fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>),
    ].find((button) => button.textContent?.includes('Run Comparison'))!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(matching.compareCandidates).toHaveBeenCalledWith({
      candidateIds: ['one', 'two'],
      jobId: undefined,
    });
  });
  it('updates the canonical public note after a masked view saves successfully', async () => {
    const { fixture } = await page(ShortlistsComponent);
    const rendered = fixture.componentInstance.filteredShortlists[0];
    fixture.componentInstance.updateNotes({ item: rendered, notes: 'Updated notes' });
    await fixture.whenStable();
    expect(fixture.componentInstance.shortlists[0].notes).toBe('Updated notes');
    expect(fixture.nativeElement.textContent).toContain('Updated notes');
  });
});
