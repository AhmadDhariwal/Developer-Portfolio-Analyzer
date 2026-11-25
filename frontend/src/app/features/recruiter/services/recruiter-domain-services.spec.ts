import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../../shared/services/api.service';
import { CandidateService } from './candidate.service';
import { RecruiterJobService } from './recruiter-job.service';
import { RecruiterMatchService } from './recruiter-match.service';

describe('Recruiter domain services', () => {
  let apiMock: Record<string, ReturnType<typeof vi.fn>>;
  let candidateService: CandidateService;
  let jobService: RecruiterJobService;
  let matchService: RecruiterMatchService;

  beforeEach(() => {
    apiMock = {
      getRecruiterHubCandidates: vi.fn().mockReturnValue(of({ candidates: [], total: 0 })),
      getRecruiterHubCandidate: vi.fn().mockReturnValue(of({ candidate: { id: 'c1' } })),
      analyzeRecruiterHubCandidate: vi.fn().mockReturnValue(of({ insight: { summary: 'ok' } })),
      getRecruiterHubJobs: vi.fn().mockReturnValue(of({ jobs: [] })),
      getRecruiterHubJob: vi.fn().mockReturnValue(of({ job: { _id: 'j1' } })),
      createRecruiterHubJob: vi.fn().mockReturnValue(of({ job: { _id: 'j1' } })),
      updateRecruiterHubJob: vi.fn().mockReturnValue(of({ job: { _id: 'j1' } })),
      archiveRecruiterHubJob: vi.fn().mockReturnValue(of({ job: { _id: 'j1', status: 'closed' } })),
      deleteRecruiterHubJob: vi.fn().mockReturnValue(of({ message: 'Deleted' })),
      getRecruiterHubMatches: vi.fn().mockReturnValue(of({ matches: [] })),
      generateRecruiterHubMatches: vi.fn().mockReturnValue(of({ matches: [] })),
      updateRecruiterHubMatchStatus: vi.fn().mockReturnValue(of({ match: { _id: 'm1' } })),
      getRecruiterHubShortlists: vi.fn().mockReturnValue(of({ shortlists: [] })),
      getRecruiterApplicationShortlists: vi.fn().mockReturnValue(of({ shortlists: [], meta: {} })),
      updateRecruiterApplicationShortlist: vi.fn().mockReturnValue(of({ shortlist: {} })),
      createRecruiterHubShortlist: vi.fn().mockReturnValue(of({ shortlist: { _id: 's1' } })),
      updateRecruiterHubShortlist: vi.fn().mockReturnValue(of({ shortlist: { _id: 's1' } })),
      deleteRecruiterHubShortlist: vi.fn().mockReturnValue(of({ message: 'Removed' })),
      compareRecruiterHubCandidates: vi.fn().mockReturnValue(of({ comparison: [] })),
    };

    TestBed.configureTestingModule({
      providers: [
        CandidateService,
        RecruiterJobService,
        RecruiterMatchService,
        { provide: ApiService, useValue: apiMock },
      ],
    });

    candidateService = TestBed.inject(CandidateService);
    jobService = TestBed.inject(RecruiterJobService);
    matchService = TestBed.inject(RecruiterMatchService);
  });

  it('delegates CandidateService queries and AI analysis with exact parameters', () => {
    candidateService.listCandidates({ search: 'Aliya', page: 2, limit: 12 }).subscribe();
    candidateService.getCandidate('cand-42').subscribe();
    candidateService.analyzeCandidate('cand-42').subscribe();

    expect(apiMock['getRecruiterHubCandidates']).toHaveBeenCalledWith({
      search: 'Aliya',
      page: 2,
      limit: 12,
    });
    expect(apiMock['getRecruiterHubCandidate']).toHaveBeenCalledWith('cand-42');
    expect(apiMock['analyzeRecruiterHubCandidate']).toHaveBeenCalledWith('cand-42');
  });

  it('delegates RecruiterJobService CRUD and archive operations', () => {
    const payload = { title: 'Senior Backend', stack: 'Node.js', requiredSkills: ['MongoDB'] };
    jobService.listJobs().subscribe();
    jobService.getJob('job-1').subscribe();
    jobService.createJob(payload).subscribe();
    jobService.updateJob('job-1', { status: 'draft' }).subscribe();
    jobService.archiveJob('job-1').subscribe();
    jobService.deleteJob('job-1').subscribe();

    expect(apiMock['getRecruiterHubJobs']).toHaveBeenCalledTimes(1);
    expect(apiMock['getRecruiterHubJob']).toHaveBeenCalledWith('job-1');
    expect(apiMock['createRecruiterHubJob']).toHaveBeenCalledWith(payload);
    expect(apiMock['updateRecruiterHubJob']).toHaveBeenCalledWith('job-1', { status: 'draft' });
    expect(apiMock['archiveRecruiterHubJob']).toHaveBeenCalledWith('job-1');
    expect(apiMock['deleteRecruiterHubJob']).toHaveBeenCalledWith('job-1');
  });

  it('delegates RecruiterMatchService matches, shortlists, and comparison calls', () => {
    matchService.listMatches({ jobId: 'job-1' }).subscribe();
    matchService.generateMatches({ jobId: 'job-1', candidateIds: ['c1', 'c2'] }).subscribe();
    matchService.updateMatchStatus('m1', 'shortlisted').subscribe();
    matchService.getShortlists({ status: 'reviewing' }).subscribe();
    matchService.addToShortlist({ candidateId: 'c1', jobId: 'job-1' }).subscribe();
    matchService.updateShortlist('s1', { status: 'interview', notes: 'Great' }).subscribe();
    matchService.removeShortlist('s1').subscribe();
    matchService.getApplicationShortlists(6, 20).subscribe();
    matchService
      .updateApplicationShortlist('private-1', { notes: 'Owner notes', expectedVersion: 3 })
      .subscribe();
    matchService.compareCandidates({ candidateIds: ['c1', 'c2'], jobId: 'job-1' }).subscribe();

    expect(apiMock['getRecruiterHubMatches']).toHaveBeenCalledWith({ jobId: 'job-1' });
    expect(apiMock['generateRecruiterHubMatches']).toHaveBeenCalledWith({
      jobId: 'job-1',
      candidateIds: ['c1', 'c2'],
    });
    expect(apiMock['updateRecruiterHubMatchStatus']).toHaveBeenCalledWith('m1', {
      status: 'shortlisted',
    });
    expect(apiMock['getRecruiterHubShortlists']).toHaveBeenCalledWith({ status: 'reviewing' });
    expect(apiMock['createRecruiterHubShortlist']).toHaveBeenCalledWith({
      candidateId: 'c1',
      jobId: 'job-1',
    });
    expect(apiMock['updateRecruiterHubShortlist']).toHaveBeenCalledWith('s1', {
      status: 'interview',
      notes: 'Great',
    });
    expect(apiMock['deleteRecruiterHubShortlist']).toHaveBeenCalledWith('s1');
    expect(apiMock['getRecruiterApplicationShortlists']).toHaveBeenCalledWith(6, 20);
    expect(apiMock['updateRecruiterApplicationShortlist']).toHaveBeenCalledWith('private-1', {
      notes: 'Owner notes',
      expectedVersion: 3,
    });
    expect(apiMock['compareRecruiterHubCandidates']).toHaveBeenCalledWith({
      candidateIds: ['c1', 'c2'],
      jobId: 'job-1',
    });
  });

  it('keeps private job pickers owner-only while metadata workspace explicitly includes shared jobs', () => {
    const jobs = [
      { _id: 'owned', access: { isOwner: true, matching: true } },
      { _id: 'shared-manager', access: { isOwner: false, edit: true, matching: false } },
      { _id: 'unknown' },
    ];
    apiMock['getRecruiterHubJobs'].mockReturnValue(of({ jobs, teams: [] }));
    jobService.listJobs().subscribe((response) => {
      expect(response.jobs.map((job: any) => job._id)).toEqual(['owned']);
    });
    jobService.listJobs(true).subscribe((response) => {
      expect(response.jobs).toEqual(jobs);
    });
  });
  it('separates evaluation job choices from metadata sharing and private comparison choices', () => {
    apiMock['getRecruiterHubJobs'].mockReturnValue(
      of({
        jobs: [
          { _id: 'owned', access: { matching: true, evaluationView: true } },
          { _id: 'metadata', access: { evaluationView: false } },
          { _id: 'evaluations', access: { matching: false, evaluationView: true } },
        ],
      }),
    );
    jobService
      .listEvaluationJobs()
      .subscribe((response) =>
        expect(response.jobs.map((job: any) => job._id)).toEqual(['owned', 'evaluations']),
      );
    jobService
      .listJobs()
      .subscribe((response) => expect(response.jobs.map((job: any) => job._id)).toEqual(['owned']));
  });
});
