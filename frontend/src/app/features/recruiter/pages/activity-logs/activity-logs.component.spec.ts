import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { RecruiterModule } from '../../recruiter.module';
import { RecruiterHubService } from '../../services/recruiter-hub.service';
import { RecruiterActivityLogsComponent } from './activity-logs.component';

describe('RecruiterActivityLogsComponent', () => {
  let component: RecruiterActivityLogsComponent;
  let fixture: ComponentFixture<RecruiterActivityLogsComponent>;
  let hubServiceMock: { getActivity: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    hubServiceMock = {
      getActivity: vi.fn().mockReturnValue(
        of({
          logs: [
            {
              _id: 'log-1',
              action: 'RECRUITER_CANDIDATE_ANALYZED',
              timestamp: '2026-11-18T10:00:00Z',
            },
            {
              _id: 'log-2',
              action: 'RECRUITER_MATCHES_GENERATED',
              timestamp: '2026-11-18T11:00:00Z',
            },
            {
              _id: 'log-3',
              action: 'RECRUITER_SHORTLIST_ADDED',
              timestamp: '2026-11-18T12:00:00Z',
            },
          ],
          meta: { total: 3 },
          filters: {
            actions: ['RECRUITER_CANDIDATE_ANALYZED', 'RECRUITER_SHORTLIST_ADDED'],
            candidates: [],
            jobs: [],
          },
        }),
      ),
    };

    await TestBed.configureTestingModule({
      imports: [RecruiterModule],
      providers: [provideRouter([]), { provide: RecruiterHubService, useValue: hubServiceMock }],
    }).compileComponents();

    fixture = TestBed.createComponent(RecruiterActivityLogsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('counts ANALYZED and MATCH events under aiActions and derives chart breakdown', () => {
    expect(component.aiActions).toBe(2);
    expect(component.shortlistActions).toBe(1);
    expect(component.actionBreakdownItems.length).toBe(3);
  });

  it('resets filters and surfaces retryable error state when API fails', () => {
    component.filters.action = 'RECRUITER_SHORTLIST_ADDED';
    component.resetFilters();
    expect(component.filters).toEqual({
      action: '',
      candidateId: '',
      jobId: '',
      from: '',
      to: '',
    });
    expect(hubServiceMock.getActivity).toHaveBeenCalledTimes(2);

    hubServiceMock.getActivity.mockReturnValueOnce(
      throwError(() => ({ error: { message: 'Stream unavailable' } })),
    );
    component.loadActivity();
    fixture.detectChanges();

    expect(component.error).toBe('Stream unavailable');
    expect((fixture.nativeElement.textContent as string)).toContain('Unable to load activity logs');
  });
});
