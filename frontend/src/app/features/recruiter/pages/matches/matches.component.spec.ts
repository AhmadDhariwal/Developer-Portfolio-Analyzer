import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';
import { RecruiterModule } from '../../recruiter.module';
import { CandidateService } from '../../services/candidate.service';
import { RecruiterJobService } from '../../services/recruiter-job.service';
import { RecruiterMatchService } from '../../services/recruiter-match.service';
import { MatchesComponent } from './matches.component';

describe('MatchesComponent', () => {
  let component: MatchesComponent;
  let fixture: ComponentFixture<MatchesComponent>;
  let matchServiceMock: {
    listMatches: ReturnType<typeof vi.fn>;
    generateMatches: ReturnType<typeof vi.fn>;
    addToShortlist: ReturnType<typeof vi.fn>;
    updateMatchStatus: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    const jobServiceMock = {
      listJobs: vi.fn().mockReturnValue(
        of({ jobs: [{ _id: 'job-1', title: 'Staff Frontend Engineer', status: 'open' }] }),
      ),
    };
    const candidateServiceMock = {
      listCandidates: vi.fn().mockReturnValue(
        of({ candidates: [{ id: 'cand-1', name: 'Elena Rostova', readinessScore: 92 }] }),
      ),
    };
    matchServiceMock = {
      listMatches: vi.fn().mockReturnValue(of({ matches: [] })),
      generateMatches: vi.fn().mockReturnValue(
        of({
          matches: [
            {
              candidate: { id: 'cand-1', name: 'Elena Rostova' },
              job: { _id: 'job-1', title: 'Staff Frontend Engineer' },
              matchScore: 91,
              status: 'generated',
            },
          ],
        }),
      ),
      addToShortlist: vi.fn().mockReturnValue(of({ shortlist: { _id: 'sl-1' } })),
      updateMatchStatus: vi.fn().mockReturnValue(of({ ok: true })),
    };

    await TestBed.configureTestingModule({
      imports: [RecruiterModule],
      providers: [
        provideRouter([]),
        { provide: RecruiterJobService, useValue: jobServiceMock },
        { provide: CandidateService, useValue: candidateServiceMock },
        { provide: RecruiterMatchService, useValue: matchServiceMock },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(MatchesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('hydrates persisted match _id after generation so status transitions work cleanly', () => {
    matchServiceMock.listMatches.mockReturnValueOnce(
      of({
        matches: [
          {
            _id: 'match-persisted-1',
            candidate: { id: 'cand-1', name: 'Elena Rostova' },
            job: { _id: 'job-1', title: 'Staff Frontend Engineer' },
            matchScore: 91,
            status: 'generated',
          },
        ],
      }),
    );

    component.runMatches();
    expect(matchServiceMock.generateMatches).toHaveBeenCalled();
    expect(component.matches[0]._id).toBe('match-persisted-1');
    expect(component.notice).toBe('Generated 1 match results.');
    expect(component.scoreDistributionItems[0]).toEqual({ label: '90-100%', count: 1 });

    component.updateStatus(component.matches[0], 'rejected');
    expect(matchServiceMock.updateMatchStatus).toHaveBeenCalledWith(
      'match-persisted-1',
      'rejected',
    );
    expect(component.rejectedCount).toBe(1);
  });
});
