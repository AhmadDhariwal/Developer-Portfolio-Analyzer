import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
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
            { _id: 'j1', title: 'Senior Backend Architect', stack: 'Node.js', status: 'open', requiredSkills: ['Node.js'] },
            { _id: 'j2', title: 'Design Systems Lead', stack: 'Angular', status: 'draft', requiredSkills: ['Angular'] },
            { _id: 'j3', title: 'Legacy Platform Maintainer', stack: 'Java', status: 'closed', requiredSkills: ['Java'] },
          ],
        }),
      ),
      createJob: vi.fn().mockReturnValue(
        of({
          job: { _id: 'j4', title: 'AI Systems Engineer', stack: 'Python', status: 'open', requiredSkills: ['Python'] },
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
});
