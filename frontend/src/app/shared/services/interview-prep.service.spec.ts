import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { InterviewPrepService } from './interview-prep.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { FrontendCacheInvalidationService } from './frontend-cache-invalidation.service';

describe('Interview Prep request lifecycle', () => {
  let service: InterviewPrepService;
  const owner = new BehaviorSubject({ _id: 'owner-a' });
  const api = {
    getInterviewPrepQuestions: vi.fn(),
    askInterviewPrepQuestion: vi.fn(),
    getInterviewPrepHistory: vi.fn(),
  };
  beforeEach(() => {
    vi.resetAllMocks();
    owner.next({ _id: 'owner-a' });
    service = new InterviewPrepService(
      api as unknown as ApiService,
      { currentUser$: owner } as unknown as AuthService,
      { register: vi.fn() } as unknown as FrontendCacheInvalidationService,
    );
  });
  afterEach(() => {
    service.ngOnDestroy();
    vi.useRealTimers();
  });
  it('coalesces active reads and revalidates completed reads with backend revisions', () => {
    const pending = new Subject<unknown>();
    api.getInterviewPrepQuestions.mockReturnValue(pending);
    const first = vi.fn();
    const second = vi.fn();
    service.getTopQuestions({ skill: 'react' }).subscribe(first);
    service.getTopQuestions({ skill: 'react' }).subscribe(second);
    expect(api.getInterviewPrepQuestions).toHaveBeenCalledTimes(1);
    pending.next({ questions: [] });
    pending.complete();
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    api.getInterviewPrepQuestions.mockReturnValue(of({ questions: [] }));
    service.getTopQuestions({ skill: 'react' }).subscribe();
    expect(api.getInterviewPrepQuestions).toHaveBeenCalledTimes(2);
  });
  it('cancels private requests and prevents held observables from replaying across users', () => {
    const pending = new Subject<unknown>();
    api.askInterviewPrepQuestion.mockReturnValue(pending);
    const held = service.askQuestion({ question: 'How do closures work?', skill: 'javascript' });
    const observer = vi.fn();
    held.subscribe(observer);
    owner.next({ _id: 'owner-b' });
    pending.next({ answer: 'Private owner-a answer' });
    held.subscribe(observer);
    expect(observer).not.toHaveBeenCalled();
    expect(api.askInterviewPrepQuestion).toHaveBeenCalledTimes(1);
    api.askInterviewPrepQuestion.mockReturnValue(of({ answer: 'Owner-b answer' }));
    service
      .askQuestion({ question: 'How do closures work?', skill: 'javascript' })
      .subscribe(observer);
    expect(observer).toHaveBeenCalledWith({ answer: 'Owner-b answer' });
  });
  it('does not cache provider failures and bounds custom requests to 20 seconds', async () => {
    vi.useFakeTimers();
    api.askInterviewPrepQuestion.mockReturnValue(new Subject());
    const error = vi.fn();
    service.askQuestion({ question: 'A valid custom question' }).subscribe({ error });
    await vi.advanceTimersByTimeAsync(20001);
    expect(error.mock.calls[0][0].name).toBe('TimeoutError');
    api.askInterviewPrepQuestion.mockReturnValue(
      throwError(() => new Error('provider unavailable')),
    );
    service.askQuestion({ question: 'A valid custom question' }).subscribe({ error });
    expect(api.askInterviewPrepQuestion).toHaveBeenCalledTimes(2);
  });
  it('propagates history failures instead of manufacturing an empty successful history', () => {
    api.getInterviewPrepHistory.mockReturnValue(throwError(() => new Error('history offline')));
    const error = vi.fn();
    service.getSessions().subscribe({ error });
    expect(error).toHaveBeenCalledOnce();
  });
});
