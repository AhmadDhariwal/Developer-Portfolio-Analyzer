import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
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
      listEvaluationJobs: vi.fn().mockReturnValue(
        of({
          jobs: [
            {
              _id: 'job-1',
              title: 'Staff Frontend Engineer',
              status: 'open',
              access: { isOwner: true, evaluationView: true, evaluationManage: true },
            },
          ],
        }),
      ),
    };
    const candidateServiceMock = {
      listCandidates: vi
        .fn()
        .mockReturnValue(
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
              access: { manage: true },
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

  it('labels shared jobs without replacement characters', () => {
    component.jobs = [
      { _id: 'shared', title: 'Shared role', status: 'open', access: { isOwner: false } },
    ];
    expect(component.jobOptions).toEqual([
      { value: 'shared', label: 'Shared role · Shared (open)' },
    ]);
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
            access: { manage: true },
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
      undefined,
    );
    expect(component.rejectedCount).toBe(1);
  });
  it('fails closed for read-only team results and refreshes after revoked access', () => {
    component.jobs = [{ _id: 'job-1', access: { evaluationView: true, evaluationManage: false } }];
    component.runMatches();
    component.shortlist({ _id: 'match', access: { manage: false } });
    component.updateStatus({ _id: 'match', access: { manage: false } }, 'rejected');
    expect(matchServiceMock.generateMatches).not.toHaveBeenCalled();
    expect(matchServiceMock.addToShortlist).not.toHaveBeenCalled();
    expect(matchServiceMock.updateMatchStatus).not.toHaveBeenCalled();
    matchServiceMock.listMatches.mockReturnValue(
      throwError(() => ({ status: 404, error: { message: 'Sharing withdrawn' } })),
    );
    component.matches = [{ _id: 'stale' }];
    component.loadMatches();
    expect(component.matches).toEqual([]);
    expect(component.error).toBe('Sharing withdrawn');
  });
});
