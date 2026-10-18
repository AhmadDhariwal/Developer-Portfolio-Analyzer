import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription, finalize, skip } from 'rxjs';
import { InterviewPrepService } from '../../shared/services/interview-prep.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { ThemeService, ThemePreference } from '../../shared/services/theme.service';
import {
  InterviewCatalogParams,
  InterviewQuestion,
  InterviewSession,
} from '../../shared/models/interview-prep.model';
import {
  CAREER_STACK_TO_SKILL,
  INTERVIEW_SKILLS,
  SKILL_LABELS,
} from '../../shared/constants/interview-prep.constants';
import { InterviewQuestionCardComponent } from './components/interview-question-card.component';

type Workspace = 'library' | 'practice' | 'sessions';

@Component({
  selector: 'app-interview-prep',
  standalone: true,
  imports: [CommonModule, FormsModule, InterviewQuestionCardComponent],
  templateUrl: './interview-prep.component.html',
  styleUrl: './interview-prep.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InterviewPrepComponent implements OnInit, OnDestroy {
  readonly skills = INTERVIEW_SKILLS;
  readonly categories = [
    'core-concepts',
    'practical-implementation',
    'debugging',
    'performance',
    'security',
    'architecture',
    'testing',
    'real-world-scenarios',
    'behavioral-technical',
    'system-design',
  ];
  readonly pageSize = 10;
  readonly skeletons = [1, 2, 3, 4];
  tab: Workspace = 'library';
  libraryKind: 'top' | 'all' = 'top';
  selectedSkill = 'javascript';
  difficulty = '';
  category = '';
  source = '';
  tags = '';
  query = '';
  loadedQuery = '';
  loadedSkill = '';
  loadedKind: 'top' | 'all' = 'top';
  questions: InterviewQuestion[] = [];
  total = 0;
  page = 1;
  serverPages = 1;
  loading = false;
  catalogError = '';
  filtersDirty = false;
  showFilters = false;
  loadedAt: Date | null = null;
  customQuestion = '';
  customResult: InterviewQuestion | null = null;
  asking = false;
  askError = '';
  askNotice = '';
  practiceFocus = '';
  practiceDifficulty = 'medium';
  practiceCount = 5;
  practiceQuestions: InterviewQuestion[] = [];
  practiceIndex = 0;
  practiceSkill = '';
  practiceNotice = '';
  practiceError = '';
  generating = false;
  selfChecks = new Map<string, 'review' | 'comfortable'>();
  recentQuestions: InterviewQuestion[] = [];
  sessions: InterviewSession[] = [];
  historyLoading = false;
  historyLoaded = false;
  historyError = '';
  selectedSession: InterviewSession | null = null;
  private catalogSub?: Subscription;
  private askSub?: Subscription;
  private practiceSub?: Subscription;
  private historySub?: Subscription;
  private readonly subscriptions = new Subscription();
  private catalogVersion = 0;
  private askVersion = 0;
  private practiceVersion = 0;
  private historyVersion = 0;
  private destroyed = false;
  private skillWasChosen = false;
  private pendingCatalogKey = '';

  constructor(
    private readonly prep: InterviewPrepService,
    private readonly profile: CareerProfileService,
    readonly theme: ThemeService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.selectedSkill = this.profileSkill();
    this.subscriptions.add(
      this.prep.owner$.pipe(skip(1)).subscribe((owner) => {
        this.cancelRequests();
        this.questions = [];
        this.total = 0;
        this.loadedAt = null;
        this.loadedSkill = '';
        this.customQuestion = '';
        this.customResult = null;
        this.askNotice = '';
        this.askError = '';
        this.practiceQuestions = [];
        this.practiceFocus = '';
        this.practiceNotice = '';
        this.practiceError = '';
        this.sessions = [];
        this.selectedSession = null;
        this.historyLoaded = false;
        this.historyError = '';
        this.recentQuestions = [];
        this.selfChecks.clear();
        this.skillWasChosen = false;
        this.selectedSkill = this.profileSkill();
        this.query = '';
        this.loadedQuery = '';
        this.difficulty = '';
        this.tags = '';
        this.category = '';
        this.source = '';
        this.tab = 'library';
        this.libraryKind = 'top';
        if (owner) this.loadCatalog(1);
        else {
          this.catalogError = 'Sign in to load your question library.';
          this.cdr.markForCheck();
        }
      }),
    );
    let careerContext = this.context;
    this.subscriptions.add(
      this.profile.careerProfile$.pipe(skip(1)).subscribe(() => {
        if (careerContext === this.context) return;
        careerContext = this.context;
        this.cancelPractice();
        if (this.practiceQuestions.length)
          this.practiceNotice =
            'Career context changed. Start a new saved session to use your current profile.';
        if (!this.skillWasChosen) {
          this.selectedSkill = this.profileSkill();
          this.loadCatalog(1);
        }
        this.cdr.markForCheck();
      }),
    );
    this.loadCatalog(1);
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.cancelRequests();
    this.subscriptions.unsubscribe();
  }
  private cancelRequests(): void {
    this.catalogVersion++;
    this.askVersion++;
    this.practiceVersion++;
    this.historyVersion++;
    this.catalogSub?.unsubscribe();
    this.askSub?.unsubscribe();
    this.practiceSub?.unsubscribe();
    this.historySub?.unsubscribe();
    this.loading = false;
    this.asking = false;
    this.generating = false;
    this.historyLoading = false;
  }
  private profileSkill(): string {
    const stack = this.profile.snapshot?.careerStack?.toLowerCase() || '';
    return (
      Object.entries(CAREER_STACK_TO_SKILL).find(([key]) => stack.includes(key))?.[1] ||
      'javascript'
    );
  }
  get context(): string {
    return [this.profile.snapshot?.careerStack, this.profile.snapshot?.experienceLevel]
      .filter(Boolean)
      .join(' · ');
  }
  skillLabel(skill: string): string {
    return SKILL_LABELS[skill] || skill;
  }
  label(value: string): string {
    return value.replaceAll(/[-_]/g, ' ');
  }
  setTheme(value: string): void {
    this.theme.setTheme(value as ThemePreference);
  }
  changeTab(tab: Workspace): void {
    if (tab === this.tab) return;
    this.tab = tab;
    if (tab === 'sessions') this.loadHistory();
    if (tab === 'library' && this.loadedAt) this.loadCatalog(this.page);
  }
  changeSkill(skill: string): void {
    this.skillWasChosen = true;
    this.selectedSkill = skill;
    this.cancelAsk();
    this.cancelPractice();
    this.loadCatalog(1);
  }
  changeLibrary(kind: 'top' | 'all'): void {
    if (kind === this.libraryKind && !this.loadedQuery) return;
    this.libraryKind = kind;
    this.query = '';
    this.loadCatalog(1);
  }
  applyFilters(): void {
    this.loadCatalog(1);
  }
  resetFilters(): void {
    this.difficulty = '';
    this.tags = '';
    this.category = '';
    this.source = '';
    this.query = '';
    this.loadCatalog(1);
  }
  loadCatalog(page = 1): void {
    const query = this.query.replace(/\s+/g, ' ').trim();
    if (query && query.length < 3) {
      this.catalogError = 'Enter at least 3 characters to search.';
      return;
    }
    const draftKey = this.catalogDraftKey();
    const requestKey = `${draftKey}:${page}`;
    if (this.loading && this.pendingCatalogKey === requestKey) return;
    this.pendingCatalogKey = requestKey;
    const version = ++this.catalogVersion;
    this.catalogSub?.unsubscribe();
    this.loading = true;
    this.catalogError = '';
    const params: InterviewCatalogParams = {
      skill: this.selectedSkill,
      difficulty: this.difficulty || undefined,
      tags: [
        ...new Set(
          this.tags
            .split(',')
            .map((tag) => tag.trim().toLowerCase())
            .filter(Boolean),
        ),
      ].sort(),
      page,
      limit: this.libraryKind === 'top' && !query ? 30 : this.pageSize,
    };
    const kind = this.libraryKind;
    const request = query
      ? this.prep.searchQuestions({ ...params, q: query, lookupOnly: true })
      : kind === 'top'
        ? this.prep.getTopQuestions(params)
        : this.prep.getAllQuestions({
            ...params,
            category: this.category || undefined,
            source: this.source || undefined,
          });
    this.catalogSub = request
      .pipe(
        finalize(() => {
          if (version === this.catalogVersion && !this.destroyed) {
            this.loading = false;
            this.cdr.markForCheck();
          }
        }),
      )
      .subscribe({
        next: (response) => {
          if (version !== this.catalogVersion) return;
          this.questions = response.questions || [];
          this.total = response.total;
          this.serverPages = response.totalPages;
          this.page = query || kind === 'all' ? response.page : 1;
          this.loadedKind = kind;
          this.loadedQuery = query;
          this.loadedSkill = params.skill;
          this.loadedAt = new Date();
          this.filtersDirty = this.catalogDraftKey() !== draftKey;
        },
        error: (error) => {
          if (version === this.catalogVersion)
            this.catalogError = this.errorText(
              error,
              'Could not refresh questions. Your previous results are still available.',
            );
        },
      });
  }
  private catalogDraftKey(): string {
    return JSON.stringify([
      this.selectedSkill,
      this.libraryKind,
      this.difficulty,
      this.category,
      this.source,
      this.tags.trim(),
      this.query.trim(),
    ]);
  }
  get localTop(): boolean {
    return this.loadedKind === 'top' && !this.loadedQuery;
  }
  get visibleQuestions(): InterviewQuestion[] {
    return this.localTop
      ? this.questions.slice((this.page - 1) * this.pageSize, this.page * this.pageSize)
      : this.questions;
  }
  get totalPages(): number {
    return this.localTop
      ? Math.max(1, Math.ceil(this.questions.length / this.pageSize))
      : Math.max(1, this.serverPages);
  }
  get range(): string {
    return !this.total
      ? '0 questions'
      : `${(this.page - 1) * this.pageSize + 1}–${Math.min(this.page * this.pageSize, this.total)} of ${this.total}`;
  }
  get resultsTitle(): string {
    return this.loadedQuery
      ? `Search results for “${this.loadedQuery}”`
      : this.loadedKind === 'top'
        ? 'Top 30 questions'
        : 'All questions';
  }
  goPage(page: number): void {
    if (this.loading || this.filtersDirty || page < 1 || page > this.totalPages) return;
    if (this.localTop && !this.filtersDirty) this.page = page;
    else this.loadCatalog(page);
  }
  cancelAsk(): void {
    this.askVersion++;
    this.askSub?.unsubscribe();
    this.asking = false;
    this.askError = '';
    this.askNotice = '';
  }
  get canAsk(): boolean {
    const length = this.customQuestion.trim().length;
    return length >= 12 && length <= 500 && !this.asking;
  }
  askCustomQuestion(): void {
    if (!this.canAsk) {
      if (!this.asking) this.askError = 'Enter a question between 12 and 500 characters.';
      return;
    }
    const version = ++this.askVersion;
    this.asking = true;
    this.askError = '';
    this.askNotice = '';
    const skill = this.selectedSkill;
    this.askSub = this.prep
      .askQuestion({ question: this.customQuestion.trim(), skill })
      .pipe(
        finalize(() => {
          if (version === this.askVersion && !this.destroyed) {
            this.asking = false;
            this.cdr.markForCheck();
          }
        }),
      )
      .subscribe({
        next: (answer) => {
          if (version !== this.askVersion) return;
          if (answer.sourceType === 'no_verified_answer') {
            this.askError =
              'No verified answer is available for this question. Try rephrasing it or search the library.';
            return;
          }
          this.customResult = { ...answer, topicKey: answer.topicKey || skill };
          this.addRecent(this.customResult);
          this.askNotice = answer.sessionId
            ? answer.duplicate
              ? 'Reused an answer from your private history.'
              : 'Answer saved to your private history.'
            : 'Using an existing answer. Its source is shown below.';
          this.historyLoaded = false;
        },
        error: (error) => {
          if (version === this.askVersion)
            this.askError = this.errorText(
              error,
              'Could not answer this question. Your previous answer is still available.',
            );
        },
      });
  }
  cancelPractice(): void {
    this.practiceVersion++;
    this.practiceSub?.unsubscribe();
    this.generating = false;
    this.practiceError = '';
  }
  generatePractice(saved = false): void {
    if (this.generating) return;
    const version = ++this.practiceVersion;
    this.generating = true;
    this.practiceError = '';
    const skill = this.selectedSkill;
    const request = saved
      ? this.prep.startSession(skill)
      : this.prep.generateQuestions({
          skill,
          query: this.practiceFocus.trim(),
          difficulty: this.practiceDifficulty,
          target: this.practiceCount,
          limit: this.practiceCount,
        });
    this.practiceSub = request
      .pipe(
        finalize(() => {
          if (version === this.practiceVersion && !this.destroyed) {
            this.generating = false;
            this.cdr.markForCheck();
          }
        }),
      )
      .subscribe({
        next: (response) => {
          if (version !== this.practiceVersion) return;
          if (!response.questions?.length) {
            this.practiceError =
              'No practice questions were returned. Adjust the focus and try again.';
            return;
          }
          this.practiceQuestions = response.questions;
          this.practiceSkill = skill;
          this.practiceIndex = 0;
          this.practiceNotice = saved
            ? 'Saved session started using your current career context.'
            : response.aiGeneratedCount
              ? 'AI practice set ready. Generated answers are unverified.'
              : 'Using existing questions. Their source and verification are shown below.';
          if (response.partial) this.practiceNotice += ' A partial set was returned.';
          if (response.personalization?.limitation)
            this.practiceNotice += ` ${response.personalization.limitation}`;
          if (saved) this.historyLoaded = false;
        },
        error: (error) => {
          if (version === this.practiceVersion)
            this.practiceError = this.errorText(
              error,
              'Could not generate a practice set. Your previous set is still available.',
            );
        },
      });
  }
  get currentPractice(): InterviewQuestion | null {
    return this.practiceQuestions[this.practiceIndex] || null;
  }
  practiceStep(step: number): void {
    this.practiceIndex = Math.min(
      this.practiceQuestions.length - 1,
      Math.max(0, this.practiceIndex + step),
    );
  }
  selfCheck(value: 'review' | 'comfortable'): void {
    if (this.currentPractice) this.selfChecks.set(this.questionKey(this.currentPractice), value);
  }
  get currentCheck(): string {
    return this.currentPractice
      ? this.selfChecks.get(this.questionKey(this.currentPractice)) || ''
      : '';
  }
  loadHistory(force = false): void {
    if (this.historyLoading || (this.historyLoaded && !force)) return;
    const version = ++this.historyVersion;
    this.historyLoading = true;
    this.historyError = '';
    this.historySub = this.prep
      .getSessions(50)
      .pipe(
        finalize(() => {
          if (version === this.historyVersion && !this.destroyed) {
            this.historyLoading = false;
            this.cdr.markForCheck();
          }
        }),
      )
      .subscribe({
        next: (sessions) => {
          if (version === this.historyVersion) {
            this.sessions = sessions;
            this.historyLoaded = true;
            if (!this.selectedSession && sessions.length) {
              this.selectedSession = sessions[0];
            }
          }
        },
        error: (error) => {
          if (version === this.historyVersion)
            this.historyError = this.errorText(error, 'Could not load history. Try again.');
        },
      });
  }
  openSession(session: InterviewSession): void {
    this.selectedSession = session;
  }
  scrollToQuestion(index: number): void {
    const el = document.getElementById(`session-q-${index}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  setDifficulty(level: string): void {
    if (this.difficulty === level) {
      this.difficulty = '';
    } else {
      this.difficulty = level;
    }
    this.filtersDirty = true;
    this.applyFilters();
  }
  get activeFilterCount(): number {
    let count = 0;
    if (this.difficulty) count++;
    if (this.category) count++;
    if (this.source) count++;
    if (this.tags?.trim()) count++;
    if (this.query?.trim()) count++;
    return count;
  }
  clearFilter(name: 'difficulty' | 'category' | 'source' | 'tags' | 'query'): void {
    if (name === 'difficulty') this.difficulty = '';
    if (name === 'category') this.category = '';
    if (name === 'source') this.source = '';
    if (name === 'tags') this.tags = '';
    if (name === 'query') this.query = '';
    this.filtersDirty = true;
    this.applyFilters();
  }
  resumeSession(session: InterviewSession): void {
    this.cancelPractice();
    this.practiceQuestions = session.questions;
    this.practiceIndex = 0;
    this.practiceSkill = session.topicKey || session.questions[0]?.topicKey || '';
    this.practiceNotice =
      'Reviewing a saved session. Evidence and verification reflect the recorded content.';
    this.tab = 'practice';
  }
  questionKey(question: InterviewQuestion): string {
    return `${question.topicKey || ''}:${question._id || question.question}`;
  }
  trackQuestion = (_index: number, question: InterviewQuestion): string =>
    this.questionKey(question);
  private addRecent(question: InterviewQuestion): void {
    this.recentQuestions = [
      question,
      ...this.recentQuestions.filter(
        (item) => this.questionKey(item) !== this.questionKey(question),
      ),
    ].slice(0, 5);
  }
  private errorText(
    error: { name?: string; error?: { message?: string } },
    fallback: string,
  ): string {
    return error?.name === 'TimeoutError'
      ? 'This request timed out. Your previous results are preserved; you can retry.'
      : error?.error?.message || fallback;
  }
}
