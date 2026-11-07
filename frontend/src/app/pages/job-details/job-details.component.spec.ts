import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { BehaviorSubject, of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { JobDetailsComponent } from './job-details.component';
import { JobService } from '../../shared/services/job.service';
import { JobActionsService } from '../../shared/services/job-actions.service';
import { AuthService } from '../../shared/services/auth.service';

describe('job details navigation and application semantics', () => {
  it('survives a missing listing and opens the next detail without marking it applied', () => {
    const params = new BehaviorSubject(convertToParamMap({ id: 'gone' }));
    const update = vi.fn();
    const job = {
      id: 'available',
      title: 'Engineer',
      company: 'Example',
      location: 'Remote',
      skills: ['TypeScript'],
      requirements: [],
      benefits: [],
      salary: '',
      description: 'Source description',
      url: 'https://example.com/apply',
      freshUntil: '2000-01-01',
    };
    TestBed.configureTestingModule({
      imports: [JobDetailsComponent],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        { provide: AuthService, useValue: { currentUser$: of({ _id: 'owner-a' }) } },
        {
          provide: JobService,
          useValue: {
            getJobById: (id: string) =>
              id === 'gone' ? throwError(() => new HttpErrorResponse({ status: 404 })) : of(job),
            clearCache: vi.fn(),
          },
        },
        {
          provide: JobActionsService,
          useValue: {
            changes$: of(0),
            seed: vi.fn(),
            update,
            state: () => ({ saved: false, applied: false, hidden: false }),
            isBusy: () => false,
            retryAt: 0,
          },
        },
      ],
    });
    const fixture = TestBed.createComponent(JobDetailsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('no longer available');
    params.next(convertToParamMap({ id: 'available' }));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Source description');
    expect(fixture.nativeElement.textContent).toContain('retained listing');
    const link = fixture.nativeElement.querySelector('a[target="_blank"]') as HTMLAnchorElement;
    expect(link.href).toBe('https://example.com/apply');
    expect(link.rel).toContain('noopener');
    link.addEventListener('click', (event) => event.preventDefault());
    link.click();
    expect(update).not.toHaveBeenCalled();
  });
});
