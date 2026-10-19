import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { InterviewPrepComponent } from './interview-prep.component';
import { InterviewPrepService } from '../../shared/services/interview-prep.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { ThemeService } from '../../shared/services/theme.service';
import {
  InterviewQuestion,
  InterviewQuestionListResponse,
} from '../../shared/models/interview-prep.model';

const question = (id: number): InterviewQuestion => ({
  question: `Question ${id}`,
  answer: 'Recorded answer',
  topicKey: 'react',
  difficulty: 'medium',
  tags: ['react'],
  rank: id,
  sourceType: 'verified_seed',
});
const result = (page = 1): InterviewQuestionListResponse => ({
  questions: Array.from({ length: 30 }, (_, index) => question(index + 1)),
  page,
  limit: 30,
  total: 30,
  totalPages: 1,
});

describe('Interview Prep workspace', () => {
  const owner = new BehaviorSubject('owner-a');
  const profileState = new BehaviorSubject({ careerStack: 'Frontend', experienceLevel: 'Student' });
  const api = {
    owner$: owner,
    getTopQuestions: vi.fn(),
    getAllQuestions: vi.fn(),
    searchQuestions: vi.fn(),
    askQuestion: vi.fn(),
    generateQuestions: vi.fn(),
    startSession: vi.fn(),
    getSessions: vi.fn(),
  };
  let component: InterviewPrepComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<InterviewPrepComponent>>;
  beforeEach(() => {
    vi.resetAllMocks();
    owner.next('owner-a');
    profileState.next({ careerStack: 'Frontend', experienceLevel: 'Student' });
    api.getTopQuestions.mockReturnValue(of(result()));
    api.getAllQuestions.mockReturnValue(
      of({ ...result(), questions: [question(31)], total: 61, totalPages: 7 }),
    );
    api.getSessions.mockReturnValue(of([]));
    TestBed.configureTestingModule({
      imports: [InterviewPrepComponent],
      providers: [
        { provide: InterviewPrepService, useValue: api },
        {
          provide: CareerProfileService,
          useValue: {
            get snapshot() {
              return profileState.value;
            },
            careerProfile$: profileState,
          },
        },
        { provide: ThemeService, useValue: { preference: () => 'light', setTheme: vi.fn() } },
      ],
    });
    fixture = TestBed.createComponent(InterviewPrepComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  it('loads only Top 30 initially and pages locally without new requests', () => {
    expect(api.getTopQuestions).toHaveBeenCalledTimes(1);
    expect(api.getAllQuestions).not.toHaveBeenCalled();
    expect(api.getSessions).not.toHaveBeenCalled();
    component.goPage(2);
    fixture.detectChanges();
    expect(component.visibleQuestions[0].rank).toBe(11);
    expect(fixture.nativeElement.textContent).toContain('11–20 of 30');
    expect(api.getTopQuestions).toHaveBeenCalledTimes(1);
  });
  it('uses server pagination and canonical category/source filters for All Questions', () => {
    component.category = 'security';
    component.source = 'ai';
    component.changeLibrary('all');
    api.getAllQuestions.mockReturnValue(
      of({ ...result(2), questions: [question(41)], total: 61, totalPages: 7, limit: 10 }),
    );
    component.goPage(2);
    expect(api.getAllQuestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, limit: 10, category: 'security', source: 'ai' }),
    );
    expect(component.visibleQuestions.map((item) => item.question)).toEqual(['Question 41']);
    expect(component.totalPages).toBe(7);
  });
  it('cancels older loads and keeps backend order when a newer topic responds', () => {
    const old = new Subject<InterviewQuestionListResponse>();
    const current = new Subject<InterviewQuestionListResponse>();
    api.getTopQuestions.mockReturnValueOnce(old).mockReturnValueOnce(current);
    component.loadCatalog();
    component.loadCatalog();
    component.changeSkill('javascript');
    expect(api.getTopQuestions).toHaveBeenCalledTimes(3);
    current.next({ ...result(), questions: [question(2), question(1)] });
    current.complete();
    old.next({ ...result(), questions: [question(99)] });
    expect(component.questions.map((item) => item.rank)).toEqual([2, 1]);
    expect(component.loadedSkill).toBe('javascript');
  });
  it('preserves valid questions when refresh fails', () => {
    api.getTopQuestions.mockReturnValue(
      throwError(() => ({ error: { message: 'Temporarily unavailable' } })),
    );
    component.loadCatalog();
    expect(component.questions.length).toBe(30);
    expect(component.catalogError).toBe('Temporarily unavailable');
    expect(component.loading).toBe(false);
  });
  it('searches with lookupOnly and never inserts a search result into the catalog', () => {
    api.searchQuestions.mockReturnValue(
      of({ ...result(), questions: [question(77)], total: 1, limit: 10 }),
    );
    component.query = 'closures';
    component.loadCatalog();
    expect(api.searchQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ q: 'closures', lookupOnly: true }),
    );
    expect(component.questions).toHaveLength(1);
    expect(component.total).toBe(1);
  });
  it('does not mislabel missing answers or discard a previous valid custom result', () => {
    component.customResult = question(1);
    component.customQuestion = 'How do closures capture state?';
    api.askQuestion.mockReturnValue(
      of({ ...question(2), sourceType: 'no_verified_answer', stored: false }),
    );
    component.askCustomQuestion();
    expect(component.customResult.question).toBe('Question 1');
    expect(component.askError).toContain('No verified answer');
    expect(component.askNotice).toBe('');
  });
  it('guards duplicate AI requests, cancels on topic changes, and keeps results on timeout', () => {
    const pending = new Subject<InterviewQuestion>();
    api.askQuestion.mockReturnValue(pending);
    component.customQuestion = 'How do closures capture state?';
    component.askCustomQuestion();
    component.askCustomQuestion();
    expect(api.askQuestion).toHaveBeenCalledTimes(1);
    component.changeSkill('java');
    pending.next(question(99));
    expect(component.customResult).toBeNull();
    component.customResult = question(1);
    api.askQuestion.mockReturnValue(throwError(() => ({ name: 'TimeoutError' })));
    component.askCustomQuestion();
    expect(component.askError).toContain('timed out');
    expect(component.customResult.question).toBe('Question 1');
  });
  it('keeps fallback and partial practice honest and preserves sets on retry failure', () => {
    api.generateQuestions.mockReturnValue(of({ ...result(), aiGeneratedCount: 0, partial: true }));
    component.generatePractice();
    expect(component.practiceNotice).toContain('Using existing questions');
    expect(component.practiceNotice).toContain('partial');
    api.generateQuestions.mockReturnValue(throwError(() => new Error('failure')));
    component.generatePractice();
    expect(component.practiceQuestions.length).toBe(30);
    expect(component.practiceError).toContain('previous set');
    component.selfCheck('review');
    expect(component.currentCheck).toBe('review');
  });
  it('starts saved sessions through the canonical backend endpoint', () => {
    api.startSession.mockReturnValue(
      of({
        ...result(),
        sessionId: 'saved',
        personalization: { limitation: 'Missing evidence does not establish inability.' },
      }),
    );
    component.generatePractice(true);
    expect(api.startSession).toHaveBeenCalledWith('react');
    expect(component.practiceNotice).toContain('Missing evidence');
    expect(component.historyLoaded).toBe(false);
  });
  it('keeps history errors distinct from empty history', () => {
    api.getSessions.mockReturnValue(throwError(() => new Error('offline')));
    component.changeTab('sessions');
    expect(component.historyError).toContain('Could not load');
    expect(component.historyLoaded).toBe(false);
    api.getSessions.mockReturnValue(of([]));
    component.loadHistory(true);
    expect(component.historyLoaded).toBe(true);
    expect(component.historyError).toBe('');
  });
  it('clears private results, history, and self-checks on logout without another unauthenticated call', () => {
    component.customResult = question(1);
    component.practiceQuestions = [question(2)];
    component.selfCheck('comfortable');
    const calls = api.getTopQuestions.mock.calls.length;
    owner.next('');
    expect(component.customResult).toBeNull();
    expect(component.questions).toEqual([]);
    expect(component.practiceQuestions).toEqual([]);
    expect(component.selfChecks.size).toBe(0);
    expect(component.sessions).toEqual([]);
    expect(api.getTopQuestions.mock.calls.length).toBe(calls);
  });
  it('updates implicit career defaults while preserving an explicit technology choice', () => {
    profileState.next({ careerStack: 'Backend', experienceLevel: 'Student' });
    expect(component.selectedSkill).toBe('nodejs');
    component.changeSkill('python');
    profileState.next({ careerStack: 'AI/ML', experienceLevel: 'Student' });
    expect(component.selectedSkill).toBe('python');
    expect(component.context).toContain('AI/ML');
  });
  it('does not auto-load catalog when technology filter changes until applyFilters is called', () => {
    const calls = api.getTopQuestions.mock.calls.length;
    component.onTechnologyChange('python');
    expect(component.selectedSkill).toBe('python');
    expect(component.filtersDirty).toBe(true);
    expect(api.getTopQuestions.mock.calls.length).toBe(calls);

    component.applyFilters();
    expect(api.getTopQuestions.mock.calls.length).toBe(calls + 1);
    expect(api.getTopQuestions).toHaveBeenLastCalledWith(
      expect.objectContaining({ skill: 'python' }),
    );
  });
});
