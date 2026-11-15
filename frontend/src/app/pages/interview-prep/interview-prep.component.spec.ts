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
    getSession: vi.fn(),
    saveProgress: vi.fn(),
    completeSession: vi.fn(),
    deleteSession: vi.fn(),
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
  it('labels question generation consistently while preserving the internal tab and generation API', () => {
    const pending = new Subject<InterviewQuestionListResponse>();
    api.generateQuestions.mockReturnValue(pending);
    const tabs = Array.from(
      fixture.nativeElement.querySelectorAll('.nav-tab'),
    ) as HTMLButtonElement[];
    const generateTab = tabs.find((tab) => tab.textContent?.includes('Generate Questions'))!;
    expect(generateTab).toBeTruthy();
    expect(tabs.some((tab) => tab.textContent?.includes('Sessions & history'))).toBe(true);
    generateTab.click();
    fixture.detectChanges();
    expect(component.tab).toBe('practice');
    expect(fixture.nativeElement.querySelector('.section-intro').textContent).toContain(
      'shared question bank',
    );
    const form = fixture.nativeElement.querySelector('.studio-form') as HTMLFormElement;
    const submit = form.querySelector('button[type=submit]') as HTMLButtonElement;
    expect(submit.textContent?.trim()).toBe('Generate Questions');
    expect(fixture.nativeElement.textContent).not.toMatch(/practice studio/i);
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(api.generateQuestions).toHaveBeenCalledTimes(1);
    expect(submit.textContent).toContain('Generating questions');
    expect(submit.disabled).toBe(true);
  });

  it('rejects incomplete sets and preserves a compatible completed set on retry failure', () => {
    api.generateQuestions.mockReturnValue(
      of({ ...result(), questions: [question(1)], partial: true }),
    );
    component.generatePractice();
    expect(component.practiceError).toContain('Insufficient');
    expect(component.practiceQuestions).toHaveLength(0);
    api.generateQuestions.mockReturnValue(
      of({ ...result(), questions: result().questions.slice(0, 5) }),
    );
    component.generatePractice();
    expect(component.practiceNotice).toContain('Using existing questions');
    api.generateQuestions.mockReturnValue(throwError(() => new Error('failure')));
    component.generatePractice();
    expect(component.practiceQuestions.length).toBe(5);
    expect(component.practiceError).toContain('previous set');
    component.selfCheck('review');
    expect(component.currentCheck).toBe('review');
  });
  it('does not leave an incompatible Hard set visible after an Easy generation failure', () => {
    component.practiceQuestions = [{ ...question(1), difficulty: 'hard' }];
    component.practiceDifficulty = 'easy';
    api.generateQuestions.mockReturnValue(
      throwError(() => new Error('Insufficient matching questions')),
    );
    component.generatePractice();
    expect(component.practiceQuestions).toEqual([]);
    expect(component.currentPractice).toBeNull();
  });
  it('sends the selected generation filters and count without dropping library constraints', () => {
    api.generateQuestions.mockReturnValue(
      of({ ...result(), questions: result().questions.slice(0, 5) }),
    );
    component.practiceDifficulty = 'easy';
    component.practiceFocus = 'hooks';
    component.practiceCount = 5;
    component.category = 'core-concepts';
    component.source = 'seed';
    component.tags = 'react, hooks';
    component.generatePractice();
    expect(api.generateQuestions).toHaveBeenCalledWith(
      expect.objectContaining({
        skill: 'react',
        difficulty: 'easy',
        query: 'hooks',
        category: 'core-concepts',
        source: 'seed',
        tags: ['react', 'hooks'],
        target: 5,
        limit: 5,
      }),
    );
  });
  it('clears a Medium library drill immediately when Easy is selected', () => {
    api.generateQuestions.mockReturnValue(
      of({ ...result(), questions: result().questions.slice(0, 5) }),
    );
    component.generatePractice();
    expect(component.practiceSetDescription).toContain('Existing library');
    component.changePracticeDifficulty('easy');
    expect(component.currentPractice).toBeNull();
    expect(component.practiceNotice).toContain('Previous drill cleared');
    expect(api.generateQuestions).toHaveBeenCalledTimes(1);
  });
  it('displays only validated Easy results and rejects Medium responses without relabeling them', () => {
    component.changePracticeDifficulty('easy');
    const easy = { ...question(1), difficulty: 'easy' };
    api.generateQuestions.mockReturnValue(
      of({
        ...result(),
        questions: Array.from({ length: 5 }, (_, index) => ({
          ...easy,
          question: `Easy question ${index}`,
        })),
        aiGeneratedCount: 5,
      }),
    );
    component.generatePractice();
    expect(component.currentPractice?.difficulty).toBe('easy');
    expect(component.practiceSetDescription).toContain('New AI-generated');
    const medium = question(2);
    api.generateQuestions.mockReturnValue(of({ ...result(), questions: [medium] }));
    component.generatePractice();
    expect(component.currentPractice).toBeNull();
    expect(component.practiceError).toContain('not displayed');
    expect(medium.difficulty).toBe('medium');
  });
  it('keeps saved Medium sessions distinct and rejects a mismatching nested generated snapshot', () => {
    const saved = { _id: 'medium-session', questions: [question(1)], topicKey: 'react' };
    api.getSession.mockReturnValue(of({ ...saved, questions: [question(2)] }));
    component.changePracticeDifficulty('easy');
    component.resumeSession(saved);
    expect(component.practiceSetDescription).toContain('Saved practice session');
    expect(component.practiceSetDescription).toContain('medium');
    expect(component.currentPractice?.question).toBe('Question 2');
    api.startSession.mockReturnValue(
      of({ ...result(), questions: [{ ...question(3), difficulty: 'easy' }], session: saved }),
    );
    component.generatePractice(true);
    expect(component.currentPractice).toBeNull();
    expect(component.practiceError).toContain('not displayed');
  });
  it('shows explicit insufficiency and never restores Medium after a failed Easy request', () => {
    component.practiceQuestions = [question(1)];
    component.changePracticeDifficulty('easy');
    api.generateQuestions.mockReturnValue(of({ ...result(), questions: [] }));
    component.generatePractice();
    expect(component.practiceError).toContain('Insufficient');
    expect(component.currentPractice).toBeNull();
    api.generateQuestions.mockReturnValue(
      throwError(() => new Error('Insufficient Easy questions')),
    );
    component.generatePractice();
    expect(component.currentPractice).toBeNull();
  });
  it('starts saved sessions through the canonical backend endpoint', () => {
    api.startSession.mockReturnValue(
      of({
        ...result(),
        sessionId: 'saved',
        questions: result().questions.slice(0, 5),
        personalization: { limitation: 'Missing evidence does not establish inability.' },
      }),
    );
    component.generatePractice(true);
    expect(api.startSession).toHaveBeenCalledWith(
      'react',
      expect.any(String),
      expect.objectContaining({
        difficulty: component.practiceDifficulty,
        limit: component.practiceCount,
      }),
    );
    expect(component.practiceNotice).toContain('Missing evidence');
    expect(component.historyLoaded).toBe(false);
  });
  it('persists self-checks and completes an owned session without awarding proficiency', () => {
    const session = {
      _id: 'saved',
      questions: [question(1)],
      progress: {},
      progressVersion: 0,
      status: 'practice' as const,
    };
    api.getSession.mockReturnValue(of(session));
    component.resumeSession(session);
    api.saveProgress.mockReturnValue(
      of({ ...session, progress: { '0': 'review' }, progressVersion: 1 }),
    );
    component.selfCheck('review');
    expect(api.saveProgress).toHaveBeenCalledWith('saved', 0, 0, 'review');
    expect(component.currentCheck).toBe('review');
    expect(component.canCompleteSession).toBe(true);
    api.completeSession.mockReturnValue(
      of({ ...session, progress: { '0': 'review' }, progressVersion: 2, status: 'completed' }),
    );
    component.completeSession();
    expect(api.completeSession).toHaveBeenCalledWith('saved', 1);
    expect(component.activePracticeSession?.status).toBe('completed');
    expect(component.canCompleteSession).toBe(false);
    component.selfCheck('comfortable');
    expect(api.saveProgress).toHaveBeenCalledTimes(1);
  });
  it('retains the same creation key after failure and preserves progress on conflict', () => {
    api.startSession.mockReturnValue(
      throwError(() => ({ error: { message: 'temporarily busy' } })),
    );
    component.generatePractice(true);
    component.retryPractice();
    expect(api.startSession.mock.calls[0][1]).toBe(api.startSession.mock.calls[1][1]);
    const session = { _id: 'saved', questions: [question(1)], progress: {}, progressVersion: 0 };
    api.getSession.mockReturnValue(of(session));
    component.resumeSession(session);
    api.saveProgress.mockReturnValue(
      throwError(() => ({ error: { message: 'Session changed. Reload.' } })),
    );
    component.selfCheck('comfortable');
    expect(component.currentCheck).toBe('');
    expect(component.practiceError).toContain('Reload');
    expect(component.savingProgress).toBe(false);
    component.retryPractice();
    expect(api.getSession).toHaveBeenCalledTimes(2);
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
  it.each(['easy', 'medium', 'hard', 'senior'])(
    'sends and displays actual %s generation difficulty',
    (difficulty) => {
      component.practiceDifficulty = difficulty;
      api.generateQuestions.mockReturnValue(
        of({
          ...result(),
          questions: Array.from({ length: 5 }, (_, i) => ({ ...question(i), difficulty })),
        }),
      );
      component.generatePractice();
      expect(component.practiceQuestions).toHaveLength(5);
      expect(component.currentPractice?.difficulty).toBe(difficulty);
      expect(api.generateQuestions).toHaveBeenCalledWith(expect.objectContaining({ difficulty }));
    },
  );
  it.each(['', 'seed', 'ai', 'scraped'])(
    'preserves source %s in submitted generation filters',
    (source) => {
      component.source = source;
      api.generateQuestions.mockReturnValue(of({ ...result(), questions: [] }));
      component.generatePractice();
      expect(api.generateQuestions).toHaveBeenCalledWith(expect.objectContaining({ source }));
      expect(component.currentPractice).toBeNull();
    },
  );
  it('clears an incompatible focus on failure and preserves custom input through retry', () => {
    api.generateQuestions.mockReturnValue(
      of({ ...result(), questions: result().questions.slice(0, 5) }),
    );
    component.generatePractice();
    component.practiceFocus = 'new focus';
    api.generateQuestions.mockReturnValue(
      throwError(() => ({ error: { message: 'Provider unavailable' } })),
    );
    component.generatePractice();
    expect(component.currentPractice).toBeNull();
    component.customQuestion = 'Can you explain React state updates?';
    api.askQuestion.mockReturnValue(
      throwError(() => ({
        error: { message: 'AI providers are temporarily unavailable. Please retry.' },
      })),
    );
    component.askCustomQuestion();
    expect(component.customQuestion).toBe('Can you explain React state updates?');
    api.askQuestion.mockReturnValue(
      of({
        ...question(1),
        question: component.customQuestion,
        sourceType: 'ai_generated',
        verificationStatus: 'unverified',
      }),
    );
    component.askCustomQuestion();
    expect(component.customResult?.verificationStatus).toBe('unverified');
    expect(api.askQuestion).toHaveBeenCalledTimes(2);
  });
  it('deletes only an acknowledged private session and clears its visible retained answer', () => {
    const session = { _id: 'owned', kind: 'custom' as const, questions: [question(1)] };
    component.sessions = [session];
    component.selectedSession = session;
    component.customResult = { ...question(1), sessionId: 'owned' };
    api.deleteSession.mockReturnValue(of({ deleted: true }));
    component.deleteSession(session);
    expect(api.deleteSession).toHaveBeenCalledWith('owned');
    expect(component.sessions).toHaveLength(0);
    expect(component.customResult).toBeNull();
  });
  it.each(['provider_unavailable', 'invalid_response', 'insufficient_results'])(
    'keeps generation failure state %s distinct without displaying incompatible questions',
    (generationStatus) => {
      component.changeTab('practice');
      api.generateQuestions.mockReturnValue(
        throwError(() => ({
          error: { generationStatus, message: `Generation ${generationStatus}` },
        })),
      );
      component.generatePractice();
      fixture.detectChanges();
      expect(component.practiceErrorKind).toBe(generationStatus);
      expect(fixture.nativeElement.querySelector('.notice.error').getAttribute('data-state')).toBe(
        generationStatus,
      );
    },
  );
  it('displays custom Q&A questions clearly in stacked session cards and hides empty metadata or redundant TOC', () => {
    const customSession = {
      _id: 'custom-1',
      kind: 'custom' as const,
      topicKey: 'system-design',
      careerStack: '',
      experienceLevel: '',
      createdAt: '2026-11-15T10:00:00.000Z',
      questions: [
        {
          ...question(101),
          topicKey: 'system-design',
          question: 'Can you tell me how system design of Instagram works?',
        },
      ],
    };
    const practiceSession = {
      _id: 'practice-1',
      kind: 'practice' as const,
      topicKey: 'system-design',
      careerStack: 'Full Stack',
      experienceLevel: 'Mid-level',
      createdAt: '2026-11-14T10:00:00.000Z',
      questions: [question(1), question(2)],
    };
    api.getSessions.mockReturnValue(of([customSession, practiceSession]));

    component.changeTab('sessions');
    fixture.detectChanges();

    const host: HTMLElement = fixture.nativeElement;
    const rows = Array.from(host.querySelectorAll('.session-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Can you tell me how system design of Instagram works?');
    expect(host.querySelectorAll('.detail-header-actions button')).toHaveLength(2);
    expect(host.querySelector('.session-toc')).toBeNull();
    expect(host.querySelector('.detail-sub')?.textContent?.trim()).toBe('1 question in this set');

    (rows[1] as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(component.selectedSession?._id).toBe('practice-1');
    expect(host.querySelectorAll('.session-toc .toc-item')).toHaveLength(2);
    expect(host.querySelector('.detail-sub')?.textContent).toContain(
      'Full Stack · Mid-level · 2 questions in this set',
    );
  });
});
