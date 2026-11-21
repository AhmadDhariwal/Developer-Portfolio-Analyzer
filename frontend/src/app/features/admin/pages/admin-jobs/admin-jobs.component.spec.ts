import { ChangeDetectorRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminModule } from '../../admin.module';
import { AdminHiringService, AdminJob, AdminJobQuery } from '../../services/admin-hiring.service';
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
});
