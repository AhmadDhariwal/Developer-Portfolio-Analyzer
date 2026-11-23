import { CommonModule } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { provideRouter, RouterLink } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { JobApplicantsComponent } from './job-applicants.component';
import { JobApplicationsService } from '../../services/job-applications.service';
import { ShortlistCardComponent } from '../../../features/recruiter/components/shortlist-card/shortlist-card.component';
import { ShortlistsComponent } from '../../../features/recruiter/pages/shortlists/shortlists.component';
import { RecruiterMatchService } from '../../../features/recruiter/services/recruiter-match.service';

describe('Owner-only application shortlist workflow', () => {
  const application = {
    _id: 'a'.repeat(64),
    jobId: 'job-1',
    applicantName: 'Private Applicant',
    jobTitle: 'Engineer',
    status: 'submitted',
    resume: { fileName: 'submitted.pdf', sha256: 'b'.repeat(64) },
    portfolio: null,
    createdAt: '2026-11-23',
  };
  const row = {
    _id: 'link-1',
    origin: 'application',
    applicationId: application._id,
    candidateId: 'private-user',
    candidate: { name: 'Private Applicant' },
    jobId: 'job-1',
    job: { _id: 'job-1', title: 'Engineer' },
    application: { _id: application._id, status: 'submitted' },
    status: 'reviewing',
    notes: 'Owner notes',
    version: 2,
    access: { manage: true, isOwner: true, manageStages: true },
  };
  async function applicants(api: any) {
    await TestBed.configureTestingModule({
      imports: [JobApplicantsComponent],
      providers: [provideRouter([]), { provide: JobApplicationsService, useValue: api }],
    }).compileComponents();
    const fixture = TestBed.createComponent(JobApplicantsComponent);
    fixture.componentRef.setInput('jobId', 'job-1');
    fixture.detectChanges();
    return fixture;
  }
  function button(fixture: any, label: string): HTMLButtonElement {
    return [...fixture.nativeElement.querySelectorAll('button')].find((b: any) =>
      b.textContent.includes(label),
    );
  }
  it('links explicitly, refreshes immediately and shows Already Shortlisted without changing application status', async () => {
    const api = {
      applicants: vi
        .fn()
        .mockReturnValueOnce(of({ applications: [application] }))
        .mockReturnValue(
          of({
            applications: [
              { ...application, shortlist: { id: row._id, status: 'shortlisted', version: 0 } },
            ],
          }),
        ),
      shortlist: vi.fn().mockReturnValue(of({ created: true })),
    };
    const fixture = await applicants(api);
    button(fixture, 'Add to Shortlist').click();
    fixture.detectChanges();
    expect(api.shortlist).toHaveBeenCalledWith('job-1', application._id, 'submitted');
    expect(api.applicants).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.textContent).toContain('Already Shortlisted');
    expect(fixture.nativeElement.textContent).toContain('Application status is unchanged');
    expect(fixture.componentInstance.applications[0].status).toBe('submitted');
    expect(fixture.nativeElement.querySelector('a[href*="source=applications"]')).toBeTruthy();
  });
  it('refreshes a stale action and exposes error/retry and terminal state', async () => {
    const api = {
      applicants: vi
        .fn()
        .mockReturnValueOnce(of({ applications: [application] }))
        .mockReturnValue(of({ applications: [{ ...application, status: 'withdrawn' }] })),
      shortlist: vi
        .fn()
        .mockReturnValue(
          throwError(() => ({ status: 409, error: { message: 'Application changed' } })),
        ),
    };
    const fixture = await applicants(api);
    button(fixture, 'Add to Shortlist').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Application changed');
    expect(button(fixture, 'Add to Shortlist')).toBeUndefined();
    api.applicants.mockReturnValueOnce(throwError(() => ({ status: 403 })));
    button(fixture, 'Refresh applicants').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.applications).toEqual([]);
    expect(button(fixture, 'Try again')).toBeTruthy();
  });
  it('loads a linked application without relying on the capped applicant list', async () => {
    const api = {
      applicants: vi.fn().mockReturnValue(of({ applications: [] })),
      application: vi.fn().mockReturnValue(
        of({
          application: {
            ...application,
            shortlist: { id: row._id, status: row.status, version: 2 },
          },
        }),
      ),
    };
    const fixture = await applicants(api);
    fixture.componentRef.setInput('applicationId', application._id);
    fixture.detectChanges();
    expect(api.application).toHaveBeenCalledWith('job-1', application._id);
    expect(fixture.nativeElement.textContent).toContain('Private Applicant');
    expect(fixture.nativeElement.querySelector('a[href="/app/recruiter/jobs/job-1"]')).toBeTruthy();
  });
  it('does not apply a late link result to another job', async () => {
    const pending = new Subject<any>();
    const api = {
      applicants: vi.fn().mockReturnValue(of({ applications: [application] })),
      shortlist: vi.fn().mockReturnValue(pending),
    };
    const fixture = await applicants(api);
    button(fixture, 'Add to Shortlist').click();
    fixture.detectChanges();
    fixture.componentRef.setInput('jobId', 'job-2');
    fixture.detectChanges();
    pending.next({ created: true });
    pending.complete();
    fixture.detectChanges();
    expect(api.applicants).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance.notice).toBe('');
  });
  it('separates terminal/internal statuses and never links a private applicant to public candidate details', async () => {
    await TestBed.configureTestingModule({
      imports: [ShortlistCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShortlistCardComponent);
    fixture.componentRef.setInput('item', {
      ...row,
      application: { ...row.application, status: 'withdrawn' },
      access: { ...row.access, manageStages: false },
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Application status: withdrawn');
    expect(text).toContain('Internal stage: reviewing');
    expect(fixture.nativeElement.querySelector('a[href*="/candidates/"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('a[href*="applicationId="]')).toBeTruthy();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('select').disabled).toBe(true);
    expect(button(fixture, 'Remove')).toBeUndefined();
    expect(button(fixture, 'Edit Note')).toBeTruthy();
  });
  async function shortlists(service: any) {
    await TestBed.configureTestingModule({
      imports: [CommonModule, FormsModule, RouterLink, ShortlistCardComponent],
      declarations: [ShortlistsComponent],
      providers: [provideRouter([]), { provide: RecruiterMatchService, useValue: service }],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();
    const fixture = TestBed.createComponent(ShortlistsComponent);
    fixture.detectChanges();
    return fixture;
  }
  it('separates source views, rejects stale list results and uses owner-only mutation endpoints', async () => {
    const pending = new Subject<any>();
    const api = {
      getShortlists: vi.fn().mockReturnValue(pending),
      getApplicationShortlists: vi.fn().mockReturnValue(of({ shortlists: [structuredClone(row)] })),
      updateShortlist: vi.fn(),
      updateApplicationShortlist: vi
        .fn()
        .mockReturnValue(of({ shortlist: { ...row, notes: 'Updated', version: 3 } })),
    };
    const fixture = await shortlists(api);
    button(fixture, 'Direct applications').click();
    fixture.detectChanges();
    pending.next({ shortlists: [{ _id: 'public', candidate: { name: 'Public' } }] });
    fixture.detectChanges();
    expect(fixture.componentInstance.shortlists[0].applicationId).toBe(application._id);
    fixture.componentInstance.updateNotes({
      item: fixture.componentInstance.shortlists[0],
      notes: 'Updated',
    });
    expect(api.updateApplicationShortlist).toHaveBeenCalledWith(row._id, {
      notes: 'Updated',
      expectedVersion: 2,
    });
    expect(api.updateShortlist).not.toHaveBeenCalled();
    api.getApplicationShortlists.mockReturnValueOnce(throwError(() => ({ status: 403 })));
    button(fixture, 'Refresh').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.shortlists).toEqual([]);
    expect(fixture.nativeElement.textContent).not.toContain('Private Applicant');
  });
});
