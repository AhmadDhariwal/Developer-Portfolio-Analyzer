import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { RecruiterModule } from '../../recruiter.module';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { JobsComponent } from './jobs.component';

describe('JobsComponent', () => {
  let component: JobsComponent;
  let fixture: ComponentFixture<JobsComponent>;
  let jobServiceMock: {
    listJobs: ReturnType<typeof vi.fn>;
    createJob: ReturnType<typeof vi.fn>;
    updateJob: ReturnType<typeof vi.fn>;
    archiveJob: ReturnType<typeof vi.fn>;
    deleteJob: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    jobServiceMock = {
      listJobs: vi.fn().mockReturnValue(
        of({
          jobs: [
            {
              _id: 'j1',
              version: 0,
              access: {
                isOwner: true,
                edit: true,
                archive: true,
                delete: true,
                manageSharing: true,
              },
              title: 'Senior Backend Architect',
              stack: 'Node.js',
              status: 'open',
              requiredSkills: ['Node.js'],
            },
            {
              _id: 'j2',
              version: 0,
              access: {
                isOwner: true,
                edit: true,
                archive: true,
                delete: true,
                manageSharing: true,
              },
              title: 'Design Systems Lead',
              stack: 'Angular',
              status: 'draft',
              requiredSkills: ['Angular'],
            },
            {
              _id: 'j3',
              version: 0,
              access: {
                isOwner: true,
                edit: true,
                archive: true,
                delete: true,
                manageSharing: true,
              },
              title: 'Legacy Platform Maintainer',
              stack: 'Java',
              status: 'closed',
              requiredSkills: ['Java'],
            },
          ],
        }),
      ),
      createJob: vi.fn().mockReturnValue(
        of({
          job: {
            _id: 'j4',
            title: 'AI Systems Engineer',
            stack: 'Python',
            status: 'open',
            requiredSkills: ['Python'],
          },
        }),
      ),
      updateJob: vi.fn().mockReturnValue(of({ job: {} })),
      archiveJob: vi.fn().mockReturnValue(of({ job: { _id: 'j1', status: 'closed' } })),
      deleteJob: vi.fn().mockReturnValue(of({ ok: true })),
    };

    await TestBed.configureTestingModule({
      imports: [RecruiterModule],
      providers: [provideRouter([]), { provide: RecruiterJobService, useValue: jobServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(JobsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('computes open/draft/closed counts and filters by status tab and search term', () => {
    expect(component.openJobsCount).toBe(1);
    expect(component.draftJobsCount).toBe(1);
    expect(component.closedJobsCount).toBe(1);
    expect(component.filteredJobs.length).toBe(3);

    component.setStatusFilter('draft');
    expect(component.filteredJobs.map((j) => j._id)).toEqual(['j2']);

    component.setStatusFilter('all');
    component.searchTerm = 'Architect';
    expect(component.filteredJobs.map((j) => j._id)).toEqual(['j1']);
  });

  it('archives a job only after confirm dialog acceptance', () => {
    component.archiveJob(component.jobs[0]);
    expect(component.confirmState().open).toBe(true);
    expect(jobServiceMock.archiveJob).not.toHaveBeenCalled();

    component.onConfirmAccepted();
    expect(jobServiceMock.archiveJob).toHaveBeenCalledWith('j1');
    expect(component.closedJobsCount).toBe(2);
  });
  it('renders team member metadata without edit/archive/delete actions', () => {
    const job = {
      _id: 'shared',
      title: 'Shared Engineer',
      status: 'open',
      teamShared: true,
      owner: { name: 'Job Creator' },
      sharedTeam: { name: 'Hiring' },
      access: { isOwner: false, edit: false, archive: false, delete: false },
    };
    component.jobs = [job];
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector('app-recruiter-job-card');
    expect(card.textContent).toContain('Job Creator');
    expect(card.textContent).toContain('Hiring');
    expect(
      Array.from(card.querySelectorAll('button') as NodeListOf<HTMLButtonElement>).map((button) =>
        button.textContent?.trim(),
      ),
    ).toEqual(['View']);
    component.editJob(job);
    component.archiveJob(job);
    component.deleteJob(job);
    expect(component.editorOpen).toBe(false);
    expect(jobServiceMock.archiveJob).not.toHaveBeenCalled();
    expect(jobServiceMock.deleteJob).not.toHaveBeenCalled();
  });
  it('sends explicit sharing intent and observed version only for the owner', () => {
    const job = {
      _id: 'j1',
      title: 'Engineer',
      role: 'Engineer',
      stack: 'Backend',
      location: 'Remote',
      status: 'open',
      requiredSkills: ['Node.js'],
      version: 4,
      teamId: 'team',
      teamShared: false,
      access: { edit: true, manageSharing: true },
    };
    component.editJob(job);
    expect(component.jobForm.controls.teamShared.value).toBe(false);
    component.jobForm.patchValue({ teamShared: true });
    component.saveJob();
    component.onConfirmAccepted();
    expect(jobServiceMock.updateJob).toHaveBeenCalledWith(
      'j1',
      expect.objectContaining({ teamShared: true, teamId: 'team', expectedVersion: 4 }),
    );
    component.editJob({ ...job, teamShared: true, access: { edit: true, manageSharing: false } });
    component.saveJob();
    component.onConfirmAccepted();
    const payload = jobServiceMock.updateJob.mock.calls.at(-1)?.[1];
    expect(payload.expectedVersion).toBe(4);
    expect(payload.teamId).toBeUndefined();
    expect(payload.teamShared).toBeUndefined();
  });
  it('closes a stale sharing editor and refreshes current access after conflict', () => {
    const job = {
      _id: 'j1',
      title: 'Engineer',
      role: 'Engineer',
      stack: 'Backend',
      location: 'Remote',
      status: 'open',
      requiredSkills: ['Node.js'],
      version: 4,
      access: { edit: true, manageSharing: true },
    };
    component.editJob(job);
    jobServiceMock.updateJob.mockReturnValue(
      throwError(() => ({ status: 409, error: { message: 'Job changed. Refresh.' } })),
    );
    component.saveJob();
    component.onConfirmAccepted();
    expect(component.editorOpen).toBe(false);
    expect(component.error).toContain('Job changed');
    expect(jobServiceMock.listJobs).toHaveBeenCalledTimes(2);
  });
});
