import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { JobApplicationsService } from '../../services/job-applications.service';
import { formatInitials, truncateSha256 } from './direct-application-ui.utils';
import { ApplicationTimelineComponent } from './application-timeline.component';
import { InternalJobsComponent } from './internal-jobs.component';
import { JobApplicantsComponent } from './job-applicants.component';
import { SubmittedPortfolioComponent } from './submitted-portfolio.component';

describe('Direct applications redesigned UI', () => {
  it('formats organization initials and truncated SHA-256 fingerprints safely', () => {
    expect(formatInitials('Alpha Engineering')).toBe('AE');
    expect(formatInitials('DevInsight')).toBe('DE');
    expect(formatInitials('')).toBe('DA');

    const fullSha = '9f8e210a47d2c31e78bf49b291c940fa189c2045e07661bfa28b5e2978333a1b';
    expect(truncateSha256(fullSha)).toBe('9f8e21…3a1b');
    expect(truncateSha256('short')).toBe('short');
    expect(truncateSha256('')).toBe('—');
  });

  it('keeps portfolio and consent opt-ins unchecked by default and toggles the application drawer', () => {
    const api = {
      discover: vi.fn().mockReturnValue(
        of({
          jobs: [
            {
              _id: 'job-1',
              organizationName: 'Alpha Systems',
              title: 'Staff Backend Engineer',
              description: 'Design resilient APIs.',
              location: 'Remote',
              employmentType: 'full-time',
              requiredSkills: ['TypeScript', 'Node.js'],
              minExperienceYears: 4,
            },
          ],
        }),
      ),
      options: vi.fn().mockReturnValue(
        of({
          portfolioHash: 'hash-1',
          resumes: [{ _id: 'res-1', fileName: 'staff-cv.pdf', uploadDate: '2026-11-20' }],
          portfolio: {
            headline: 'Distributed systems engineer',
            summary: 'Builds reliable APIs',
            skills: ['TypeScript', 'Node.js'],
            projects: [{ title: 'Queue', description: 'Async worker', tech: ['Redis'] }],
          },
        }),
      ),
      mine: vi.fn().mockReturnValue(of({ applications: [] })),
      submit: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [InternalJobsComponent],
      providers: [{ provide: JobApplicationsService, useValue: api }],
    });

    const fixture: ComponentFixture<InternalJobsComponent> =
      TestBed.createComponent(InternalJobsComponent);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Alpha Systems');
    expect(text).toContain('AS');
    expect(text).toContain('Open internal roles');

    const reviewBtn = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Review and apply');
    expect(reviewBtn).toBeTruthy();
    reviewBtn!.click();
    fixture.detectChanges();

    const portfolioCheckbox = fixture.nativeElement.querySelector(
      'input[name="portfolio"]',
    ) as HTMLInputElement;
    const consentCheckbox = fixture.nativeElement.querySelector(
      'input[name="consent"]',
    ) as HTMLInputElement;
    expect(portfolioCheckbox.checked).toBe(false);
    expect(consentCheckbox.checked).toBe(false);
    expect(fixture.nativeElement.querySelector('#direct-resume')).toBeTruthy();

    const cancelBtn = Array.from(
      fixture.nativeElement.querySelectorAll('button') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.trim() === 'Cancel');
    cancelBtn!.click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('#direct-resume')).toBeNull();
  });

  it('filters recruiter direct applicants by status tab and separates portfolio privacy tags', () => {
    const fullShaA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const fullShaB = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const api = {
      applicants: vi.fn().mockReturnValue(
        of({
          applications: [
            {
              _id: 'app-1',
              jobId: 'job-1',
              jobTitle: 'Staff Backend Engineer',
              applicantName: 'Aliya Dev',
              status: 'reviewing',
              resume: { fileName: 'aliya.pdf', sha256: fullShaA },
              portfolio: {
                headline: 'Backend Specialist',
                summary: 'Scalable APIs',
                skills: ['TypeScript'],
                projects: [],
              },
              createdAt: '2026-11-20T00:00:00.000Z',
            },
            {
              _id: 'app-2',
              jobId: 'job-1',
              jobTitle: 'Staff Backend Engineer',
              applicantName: 'Bilal Khan',
              status: 'submitted',
              resume: { fileName: 'bilal.pdf', sha256: fullShaB },
              portfolio: null,
              createdAt: '2026-11-21T00:00:00.000Z',
            },
          ],
        }),
      ),
      status: vi.fn(),
      resume: vi.fn(),
    };

    TestBed.configureTestingModule({
      imports: [JobApplicantsComponent],
      providers: [{ provide: JobApplicationsService, useValue: api }],
    });

    const fixture = TestBed.createComponent(JobApplicantsComponent);
    fixture.componentInstance.jobId = 'job-1';
    fixture.componentInstance.ngOnChanges();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('2 applicant(s)');
    expect(fixture.nativeElement.textContent).toContain('Portfolio snapshot included');
    expect(fixture.nativeElement.textContent).toContain('Portfolio snapshot not shared');

    const submittedTab = Array.from(
      fixture.nativeElement.querySelectorAll('[role="tab"]') as NodeListOf<HTMLButtonElement>,
    ).find((b) => b.textContent?.includes('Submitted (1)'));
    expect(submittedTab).toBeTruthy();
    submittedTab!.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Bilal Khan');
    expect(fixture.nativeElement.textContent).not.toContain('Aliya Dev');
  });

  it('renders SubmittedPortfolioComponent empty vs frozen evidence cleanly', () => {
    TestBed.configureTestingModule({
      imports: [SubmittedPortfolioComponent],
    });

    const fixture = TestBed.createComponent(SubmittedPortfolioComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Portfolio snapshot was not shared.');

    fixture.componentRef.setInput('portfolio', {
      headline: 'Systems Lead',
      summary: 'Low-latency APIs',
      skills: ['Go', 'Redis'],
      projects: [{ title: 'Broker', description: 'Event bus', tech: ['Go'] }],
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Systems Lead');
    expect(text).toContain('Broker');
    expect(text).toContain('Go');
  });

  it('renders ApplicationTimelineComponent empty state vs vertical status steps cleanly', () => {
    TestBed.configureTestingModule({
      imports: [ApplicationTimelineComponent],
    });

    const fixture = TestBed.createComponent(ApplicationTimelineComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Status timeline');
    expect(fixture.nativeElement.textContent).toContain('0 events');
    expect(fixture.nativeElement.textContent).toContain('No status transitions recorded yet.');

    fixture.componentRef.setInput('timeline', [
      { status: 'submitted', at: '2026-11-19T15:15:00.000Z' },
      { status: 'reviewing', at: '2026-11-24T15:15:00.000Z' },
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('2 events');
    expect(text).toContain('Step 1');
    expect(text).toContain('Step 2');
    expect(text).toContain('submitted');
    expect(text).toContain('reviewing');

    const steps = fixture.nativeElement.querySelectorAll('.timeline-step');
    expect(steps.length).toBe(2);
    expect(steps[0].classList.contains('timeline-step--submitted')).toBe(true);
    expect(steps[1].classList.contains('timeline-step--reviewing')).toBe(true);
    expect(steps[1].classList.contains('timeline-step--latest')).toBe(true);
  });
});
