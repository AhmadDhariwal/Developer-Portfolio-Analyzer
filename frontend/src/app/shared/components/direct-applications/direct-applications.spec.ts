import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { vi } from 'vitest';
import { InternalJobsComponent } from './internal-jobs.component';
import { JobApplicantsComponent } from './job-applicants.component';
import { JobApplicationsService } from '../../services/job-applications.service';

describe('Direct application components', () => {
  const job = {
    _id: 'job',
    title: 'Engineer',
    description: 'Build',
    requiredSkills: ['Angular'],
    minExperienceYears: 0,
    location: 'Remote',
    employmentType: 'full-time',
  };
  const application = {
    _id: 'application',
    jobId: 'job',
    jobTitle: 'Engineer',
    status: 'submitted',
    resume: { fileName: 'submitted.pdf' },
    createdAt: '2026-11-21',
  };
  let api: {
    discover: ReturnType<typeof vi.fn>;
    options: ReturnType<typeof vi.fn>;
    mine: ReturnType<typeof vi.fn>;
    submit: ReturnType<typeof vi.fn>;
    applicants: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    resume: ReturnType<typeof vi.fn>;
    withdraw: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    api = {
      discover: vi.fn(() => of({ jobs: [job] })),
      options: vi.fn(() =>
        of({
          resumes: [{ _id: 'resume', fileName: 'submitted.pdf' }],
          portfolio: { headline: 'Preview', summary: '', skills: [], projects: [] },
          portfolioHash: 'preview-hash',
        }),
      ),
      mine: vi.fn(() => of({ applications: [] })),
      submit: vi.fn(() => of({ application })),
      applicants: vi.fn(() => of({ applications: [application] })),
      status: vi.fn(() => of({})),
      resume: vi.fn(),
      withdraw: vi.fn(() =>
        of({
          application: {
            ...application,
            status: 'withdrawn',
            timeline: [{ status: 'withdrawn', at: '2026-11-22' }],
          },
        }),
      ),
    };
    TestBed.configureTestingModule({
      imports: [InternalJobsComponent, JobApplicantsComponent],
      providers: [{ provide: JobApplicationsService, useValue: api }],
    });
  });
  it('requires selection and consent, defaults to no portfolio disclosure and shows success/status', () => {
    const fixture = TestBed.createComponent(InternalJobsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.choose(job);
    component.submit();
    expect(api.submit).not.toHaveBeenCalled();
    component.resumeId = 'resume';
    component.submit();
    expect(api.submit).not.toHaveBeenCalled();
    component.consent = true;
    component.submit();
    expect(api.submit).toHaveBeenCalledWith('job', 'resume', false, 'preview-hash');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Application submitted');
    expect(component.applied('job')?.status).toBe('submitted');
  });
  it('keeps the consent form available for a safe retry after submission failure', () => {
    api.submit.mockReturnValue(throwError(() => ({ error: { message: 'Job closed' } })));
    const fixture = TestBed.createComponent(InternalJobsComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.choose(job);
    component.resumeId = 'resume';
    component.consent = true;
    component.submit();
    fixture.detectChanges();
    expect(component.busy).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Job closed');
    expect(component.selected?._id).toBe('job');
  });
  it('shows a recoverable loading failure', () => {
    api.discover.mockReturnValue(throwError(() => Error('offline')));
    const fixture = TestBed.createComponent(InternalJobsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Unable to load internal jobs');
    expect(fixture.componentInstance.loading).toBe(false);
  });
  it('history failure never reports an empty history and can recover independently', () => {
    api.mine.mockReturnValue(throwError(() => Error('404')));
    const fixture = TestBed.createComponent(InternalJobsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Unable to load application history');
    expect(fixture.nativeElement.textContent).not.toContain('You have not submitted');
    expect(fixture.nativeElement.textContent).toContain('Engineer');
    expect(fixture.componentInstance.canApply).toBe(false);
    api.mine.mockReturnValue(of({ applications: [] }));
    fixture.componentInstance.loadHistory();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('You have not submitted');
    expect(api.discover).toHaveBeenCalledTimes(1);
  });
  it('options failure preserves discovery and history; delayed history has no empty message', () => {
    const history = new Subject<{ applications: unknown[] }>();
    api.mine.mockReturnValue(history);
    api.options.mockReturnValue(throwError(() => Error('unavailable')));
    const fixture = TestBed.createComponent(InternalJobsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Engineer');
    expect(fixture.nativeElement.textContent).toContain('Loading application history');
    expect(fixture.nativeElement.textContent).not.toContain('You have not submitted');
    expect(fixture.nativeElement.textContent).not.toContain('Upload a PDF');
    history.next({ applications: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('You have not submitted');
    expect(fixture.componentInstance.optionsState.error).toBeTruthy();
  });
  it('withdraws only after explicit confirmation and renders a safe terminal timeline', () => {
    api.mine.mockReturnValue(of({ applications: [application] }));
    const fixture = TestBed.createComponent(InternalJobsComponent);
    fixture.detectChanges();
    const button = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.includes('Withdraw application'))!;
    button.click();
    fixture.detectChanges();
    expect(api.withdraw).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('You cannot reapply');
    fixture.componentInstance.confirmWithdrawal();
    fixture.detectChanges();
    expect(api.withdraw).toHaveBeenCalledWith('application', 'submitted');
    expect(fixture.nativeElement.textContent).toContain('Reapplication is unavailable');
    expect(fixture.componentInstance.applications[0].status).toBe('withdrawn');
  });
  it('refreshes history on a stale withdrawal without claiming success', () => {
    api.mine.mockReturnValue(of({ applications: [application] }));
    const fixture = TestBed.createComponent(InternalJobsComponent);
    fixture.detectChanges();
    fixture.componentInstance.withdrawal = fixture.componentInstance.applications[0];
    api.mine.mockReturnValue(of({ applications: [{ ...application, status: 'rejected' }] }));
    api.withdraw.mockReturnValue(throwError(() => ({ status: 409 })));
    fixture.componentInstance.confirmWithdrawal();
    fixture.detectChanges();
    expect(fixture.componentInstance.applications[0].status).toBe('rejected');
    expect(fixture.componentInstance.busy).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Application changed');
    expect(fixture.nativeElement.textContent).not.toContain('Application withdrawn.');
  });
  it('refreshes recruiter state after a conflict and hides actions for terminal applicants', () => {
    const fixture = TestBed.createComponent(JobApplicantsComponent);
    fixture.componentRef.setInput('jobId', 'job');
    fixture.detectChanges();
    api.applicants.mockReturnValue(of({ applications: [{ ...application, status: 'withdrawn' }] }));
    api.status.mockReturnValue(throwError(() => ({ status: 409 })));
    fixture.componentInstance.status(fixture.componentInstance.applications[0], 'reviewing');
    fixture.detectChanges();
    expect(fixture.componentInstance.applications[0].status).toBe('withdrawn');
    expect(fixture.nativeElement.textContent).toContain('Application changed');
    expect(fixture.nativeElement.textContent).not.toContain('Mark rejected');
    expect(fixture.nativeElement.textContent).not.toContain('Mark reviewing');
  });
  it('recruiter loads submitted evidence and uses the applicant-visible status endpoint', () => {
    const fixture = TestBed.createComponent(JobApplicantsComponent);
    fixture.componentRef.setInput('jobId', 'job');
    fixture.detectChanges();
    expect(api.applicants).toHaveBeenCalledWith('job');
    expect(fixture.nativeElement.textContent).toContain('submitted.pdf');
    fixture.componentInstance.status(fixture.componentInstance.applications[0], 'reviewing');
    expect(api.status).toHaveBeenCalledWith('job', 'application', 'reviewing', 'submitted');
  });
});
