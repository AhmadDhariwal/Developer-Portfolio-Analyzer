import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminModule } from '../../admin.module';
import {
  AdminHiringService,
  AdminJob,
  AdminJobQuery,
  AdminRankedCandidate,
} from '../../services/admin-hiring.service';
import { AdminJobsPageComponent } from './admin-jobs.component';

describe('AdminJobsPageComponent', () => {
  const job: AdminJob = {
    _id: 'job-1',
    title: 'Frontend Engineer',
    role: 'Engineer',
    description: 'Build and maintain the frontend.',
    stack: 'Frontend',
    requiredSkills: [],
    preferredSkills: [],
    minExperienceYears: 0,
    location: '',
    employmentType: 'full-time',
    status: 'open',
  };

  let component: AdminJobsPageComponent;
  let jobs: AdminJob[];
  const getJobs = vi.fn((query: AdminJobQuery) =>
    of({ jobs, page: query.page, limit: 10, total: jobs.length, totalPages: 1, hasMore: false }),
  );

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [AdminModule],
      providers: [{ provide: ChangeDetectorRef, useValue: { markForCheck: () => {} } }],
    });
    jobs = [];
    getJobs.mockClear();
    component = TestBed.runInInjectionContext(
      () =>
        new AdminJobsPageComponent({
          getJobs,
          createJob: () => {
            jobs = [job];
            return of(job);
          },
          updateJob: () => {
            jobs = [{ ...job, title: 'Senior Frontend Engineer' }];
            return of(jobs[0]);
          },
          closeJob: () => {
            jobs = [{ ...jobs[0], status: 'closed' }];
            return of(jobs[0]);
          },
          deleteJob: () => {
            jobs = [];
            return of(undefined);
          },
        } as unknown as AdminHiringService),
    );
    component.ngOnInit();
  });

  it('reloads page one once per successful mutation and deduplicates unchanged filters', () => {
    component.onStatusChange('');
    expect(getJobs).toHaveBeenCalledTimes(1);

    Object.assign(component.form, { title: job.title, description: job.description });
    component.createJob();
    expect(component.jobs).toEqual([job]);
    expect(component.message).toBe('Job created successfully.');

    component.openJobEdit(component.jobs[0]);
    component.saveJobEdit();
    expect(component.jobs[0].title).toBe('Senior Frontend Engineer');

    component.closeJob(component.jobs[0]);
    expect(component.jobs[0].status).toBe('closed');

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      component.openJobDetails(component.jobs[0]);
      component.deleteJob(component.jobs[0]);
      expect(component.jobs).toEqual([]);
      expect(component.drawerJob).toBeNull();
      expect(getJobs).toHaveBeenCalledTimes(5);
    } finally {
      confirm.mockRestore();
    }
  });

  it('clears stale rows after a list error and loads again on a filter change', () => {
    Object.assign(component.form, { title: job.title, description: job.description });
    component.createJob();
    component.openJobDetails(job);

    getJobs.mockImplementationOnce(() => throwError(() => new Error('List unavailable')));
    component.onStatusChange('draft');
    expect(component.jobsLoading).toBe(false);
    expect(component.hasLoadedJobs).toBe(false);
    expect(component.drawerJob).toBeNull();
    expect(component.message).toBe('Failed to load organization jobs.');

    component.onStatusChange('');
    expect(component.hasLoadedJobs).toBe(true);
    expect(component.jobs).toEqual([job]);
    expect(component.message).toBe('');
  });

  async function rankingFixture() {
    const response = new Subject<AdminRankedCandidate[]>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [AdminModule],
      providers: [
        { provide: AdminHiringService, useValue: { getJobs, rankCandidates: () => response } },
      ],
    });
    jobs = [job];
    const fixture = TestBed.createComponent(AdminJobsPageComponent);
    await fixture.whenStable();
    return { fixture, response, element: fixture.nativeElement as HTMLElement };
  }

  it('renders ranking loading and delayed results without another click or manual detection', async () => {
    const { fixture, response, element } = await rankingFixture();
    fixture.componentInstance.runRanking();
    await fixture.whenStable();
    expect(element.textContent).toContain('Running AI ranking');
    expect(element.querySelector<HTMLButtonElement>('.btn-rank')?.disabled).toBe(true);

    response.next([
      {
        rank: 1,
        rankScore: 92,
        candidateId: 'candidate-1',
        candidate: { fullName: 'Ada Developer', githubUsername: 'ada', stack: 'Frontend' },
        aiInsight: {
          summary: 'Strong match',
          strengths: [],
          weaknesses: [],
          recommendation: 'Interview',
        },
      },
    ]);
    await fixture.whenStable();
    expect(element.querySelector('.rank-card h4')?.textContent).toBe('Ada Developer');
    expect(element.textContent).toContain('AI ranking completed for 1 candidate.');
    expect(element.textContent).not.toContain('Running AI ranking');
    expect(element.querySelector<HTMLButtonElement>('.btn-rank')?.disabled).toBe(false);
    fixture.destroy();
  });

  it('renders delayed ranking errors and empty results immediately', async () => {
    const { fixture, response, element } = await rankingFixture();
    fixture.componentInstance.runRanking();
    await fixture.whenStable();
    response.error({ error: { message: 'Ranking unavailable' } });
    await fixture.whenStable();
    expect(element.textContent).toContain('Ranking unavailable');
    expect(element.textContent).not.toContain('Running AI ranking');
    expect(element.querySelector('.rank-card')).toBeNull();
    expect(element.querySelector<HTMLButtonElement>('.btn-rank')?.disabled).toBe(false);
    fixture.destroy();
  });

  it('renders no-match results and validation inside an open edit drawer', async () => {
    const { fixture, response, element } = await rankingFixture();
    fixture.componentInstance.runRanking();
    await fixture.whenStable();
    response.next([]);
    await fixture.whenStable();
    expect(element.textContent).toContain('no candidates matched this job yet');
    fixture.componentInstance.openJobEdit(job);
    await fixture.whenStable();
    fixture.componentInstance.editForm.title = '';
    fixture.componentInstance.saveJobEdit();
    await fixture.whenStable();
    expect(element.textContent).toContain('Job title is required.');
    expect(element.querySelector('.detail-drawer')).not.toBeNull();
    expect(element.querySelector('.detail-drawer [role="alert"]')?.textContent).toContain(
      'Job title is required.',
    );
    fixture.destroy();
  });

  it('announces validation and delayed server errors beside the create action and recovers on retry', async () => {
    TestBed.resetTestingModule();
    const response = new Subject<AdminJob>();
    const retry = new Subject<AdminJob>();
    const createJob = vi.fn().mockReturnValueOnce(response).mockReturnValueOnce(retry);
    TestBed.configureTestingModule({
      imports: [AdminModule],
      providers: [{ provide: AdminHiringService, useValue: { getJobs, createJob } }],
    });
    const fixture = TestBed.createComponent(AdminJobsPageComponent);
    const component = fixture.componentInstance;
    const element = fixture.nativeElement as HTMLElement;
    await fixture.whenStable();
    component.createJob();
    await fixture.whenStable();
    expect(element.querySelector('.create-panel [role="alert"]')?.textContent).toContain(
      'Job title is required.',
    );
    Object.assign(component.form, { title: job.title, description: job.description });
    component.createJob();
    response.error({ error: { message: 'Synthetic create unavailable' } });
    await fixture.whenStable();
    expect(element.querySelector('.create-panel [role="alert"]')?.textContent).toBe(
      'Synthetic create unavailable',
    );
    expect(element.querySelector('app-shared-message .shared-message')).toBeNull();
    component.createJob();
    retry.next(job);
    await fixture.whenStable();
    expect(component.createError).toBe('');
    expect(element.querySelector('.create-panel [role="alert"]')).toBeNull();
    fixture.destroy();
  });
});
