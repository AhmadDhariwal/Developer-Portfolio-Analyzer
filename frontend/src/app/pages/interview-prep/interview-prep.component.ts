import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Subscription } from 'rxjs';
import { InterviewPrepService, InterviewQuestion, InterviewQuestionListResponse } from '../../shared/services/interview-prep.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { INTERVIEW_SKILLS, SKILL_LABELS, SKILL_MATCH_ALIASES, CAREER_STACK_TO_SKILL } from '../../shared/constants/interview-prep.constants';

type InterviewTab = 'search' | 'ai';
type SearchState = 'idle' | 'searching' | 'match-db' | 'match-seed' | 'no-match' | 'ai-generating' | 'ai-done' | 'ai-reused' | 'error';
type AnswerSection = { title: string; body: string; kind?: 'text' | 'list' | 'code' | 'context'; items?: string[] };

const LOW_CONFIDENCE_WARN_THRESHOLD = 0.6;
const VIEWED_QUESTIONS_KEY = 'devinsight_interview_viewed';
const MAX_VIEWED_ENTRIES = 200;
const VIEWED_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface ViewedEntry {
  questionId: string;
  question: string;
  topicKey: string;
  viewedAt: number;
  answerViewed: boolean;
}

@Component({
  selector: 'app-interview-prep',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './interview-prep.component.html',
  styleUrl: './interview-prep.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InterviewPrepComponent implements OnInit, OnDestroy {
  private readonly subscriptions = new Subscription();

  readonly pageSize = 10;
  readonly topQuestionLimit = 30;
  readonly allQuestionBatchLimit = 50;
  readonly skills = INTERVIEW_SKILLS;
  readonly skillLabels = SKILL_LABELS;
  readonly practiceCounts = [5, 10];
  readonly tabs: Array<{ id: InterviewTab; label: string }> = [
    { id: 'search', label: 'Search & Questions' },
    { id: 'ai', label: 'AI Generated & Recent' }
  ];
  readonly answerSectionTitles = [
    'Short answer',
    'Explanation',
    'Key Points',
    'Example',
    'Real-world Use Case',
    'Common Mistakes',
    'Interview Tip'
  ];

  activeTab: InterviewTab = 'search';
  selectedSkill = '';
  localQuestionSkill = '';
  selectedDifficulty = '';
  tagsInput = '';
  selectedCategory = '';
  selectedSource = '';
  aiPromptQuery = '';
  aiDifficulty = '';
  practiceCount = 5;
  customQuestion = '';
  customResult: InterviewQuestion | null = null;

  // ── Search state machine ──
  searchState: SearchState = 'idle';
  searchMatches: InterviewQuestion[] = [];
  searchAttempted = false;
  canAskAI = false;
  searchMatchPage = 1;
  searchMatchTotal = 0;
  searchMatchesExhausted = false;

  // ── Recent / History ──
  recentQuestions: InterviewQuestion[] = []; // in-memory session questions
  historyQuestions: InterviewQuestion[] = []; // real backend history
  isLoadingHistory = false;
  historyLoaded = false;

  // ── Generation ──
  generatedQuestions: InterviewQuestion[] = [];
  aiGeneratedCount = 0;
  currentSource = '';

  // ── Filter state ──
  filtersDirty = false;
  isApplyingFilters = false;

  // ── Error / status ──
  customErrorMessage = '';
  errorMessage = '';
  copyMessage = '';

  // ── Loading flags ──
  isAskingQuestion = false;
  isSearchingMatches = false;
  isLoading = false;
  isLoadingMore = false;
  isLoadingAll = false;
  isLoadingAllMore = false;
  isGeneratingAI = false;

  // ── Top 30 pagination ──
  questions: InterviewQuestion[] = [];
  topPage = 1;
  total = 0;
  currentPage = 1;
  totalPages = 1;
  allowEnrichmentLoadMore = true;

  // ── All Questions pagination ──
  allQuestions: InterviewQuestion[] = [];
  allBatchPage = 1;
  allVisiblePage = 1;
  allTotal = 0;

  // ── UI state ──
  openAnswers = new Set<string>();
  skeletonItems = Array.from({ length: 6 });
  highlightedQuestions: SafeHtml[] = [];
  highlightedAnswers: SafeHtml[] = [];

  // ── Learning intelligence ──
  private readonly viewedEntries = this.loadViewedEntries();
  viewedTopicKeys = new Set<string>();
  sessionAiHitCount = 0;
  sessionAiNewCount = 0;
  sessionDbLookupCount = 0;

  constructor(
    private readonly prepService: InterviewPrepService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    // Pre-select skill from career profile if a strong match exists.
    const profileStack = this.careerProfileService.snapshot?.careerStack;
    if (profileStack && !this.selectedSkill) {
      const profileSkill = this.resolveProfileSkill(profileStack);
      if (profileSkill && this.skills.includes(profileSkill)) {
        this.selectedSkill = profileSkill;
      }
    }
    this.fetchTopQuestions(true);
    this.fetchAllQuestions(true);
    this.loadHistory();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.viewedTopicKeys.clear();
  }

  // ── Career profile helpers ──

  /**
   * Resolves a skill key from career stack text, used only for the dropdown pre-selection.
   * Returns '' if no strong match — avoids forcing a wrong skill.
   */
  private resolveProfileSkill(careerStack: string): string {
    if (!careerStack) return '';
    const normalized = String(careerStack).toLowerCase();
    for (const [key, skill] of Object.entries(CAREER_STACK_TO_SKILL)) {
      if (normalized.includes(key)) return skill;
    }
    return '';
  }

  /** Maps career stack to default skill for API calls (has a 'mern' fallback). */
  private mapCareerProfileToSkill(careerStack: string): string {
    if (!careerStack) return 'mern';
    const normalized = String(careerStack).toLowerCase();
    for (const [key, skill] of Object.entries(CAREER_STACK_TO_SKILL)) {
      if (normalized.includes(key)) return skill;
    }
    return 'mern';
  }

  private resolveDefaultSkill(): string {
    return this.mapCareerProfileToSkill(this.careerProfileService.snapshot?.careerStack);
  }

  /** ── View helpers ── */

  get canLoadMore(): boolean {
    return this.topPage < this.topTotalPages;
  }

  get canLoadMoreAll(): boolean {
    return !this.isLoadingAll && !this.isLoadingAllMore && this.allQuestions.length < this.allTotal;
  }

  get canLoadMoreSearchMatches(): boolean {
    return (
      this.searchAttempted &&
      !this.isSearchingMatches &&
      !this.searchMatchesExhausted &&
      this.searchMatches.length > 0
    );
  }

  get hasQuestions(): boolean {
    return this.questions.length > 0;
  }

  get defaultSkill(): string {
    return this.resolveDefaultSkill();
  }

  get activeCatalogSkill(): string {
    return this.selectedSkill || this.defaultSkill;
  }

  get isGlobalSkillSelected(): boolean {
    return Boolean(this.selectedSkill);
  }

  get showLocalQuestionSkillSelector(): boolean {
    return !this.isGlobalSkillSelected;
  }

  get effectiveQuestionSkill(): string {
    return this.selectedSkill || this.localQuestionSkill;
  }

  get questionSkillLabel(): string {
    return this.getSkillLabel(this.effectiveQuestionSkill || this.activeCatalogSkill);
  }

  get skillValidationMessage(): string {
    return this.effectiveQuestionSkill ? '' : 'Please select a skill';
  }

  get canSearchQuestion(): boolean {
    return Boolean(this.effectiveQuestionSkill) && this.customQuestion.trim().length >= 3 && !this.isSearchingMatches;
  }

  get canAskQuestion(): boolean {
    return Boolean(this.effectiveQuestionSkill) && this.customQuestion.trim().length >= 12 && !this.isAskingQuestion;
  }

  get canGenerateAIQuestions(): boolean {
    return Boolean(
      this.selectedSkill &&
      this.aiPromptQuery.replace(/\s+/g, ' ').trim() &&
      this.aiDifficulty &&
      this.practiceCount
    );
  }

  get visibleTopQuestions(): InterviewQuestion[] {
    const start = (this.topPage - 1) * this.pageSize;
    return this.questions.slice(start, start + this.pageSize);
  }

  get topTotalPages(): number {
    return Math.max(1, Math.ceil(this.questions.length / this.pageSize));
  }

  get topRangeLabel(): string {
    if (!this.questions.length) return '0 of 0';
    const start = (this.topPage - 1) * this.pageSize + 1;
    const end = Math.min(this.topPage * this.pageSize, this.questions.length);
    return `${start}–${end} of ${this.questions.length}`;
  }

  get allRangeLabel(): string {
    if (!this.allTotal || !this.allQuestions.length) return '0 of 0';
    const start = (this.allVisiblePage - 1) * this.pageSize + 1;
    const end = Math.min(this.allVisiblePage * this.pageSize, this.allQuestions.length, this.allTotal);
    return `${start}–${end} of ${this.allTotal}`;
  }

  get visibleAllQuestions(): InterviewQuestion[] {
    const start = (this.allVisiblePage - 1) * this.pageSize;
    return this.allQuestions.slice(start, start + this.pageSize);
  }

  get allTotalPages(): number {
    return Math.max(1, Math.ceil(this.allQuestions.length / this.pageSize));
  }

  /** AI reuse-rate metric for the current session. */
  get aiReuseRate(): string {
    const total = this.sessionAiHitCount + this.sessionAiNewCount;
    if (total === 0) return '—';
    return `${Math.round((this.sessionAiHitCount / total) * 100)}% reuse (${this.sessionAiHitCount}/${total})`;
  }

  /** Dynamic label for the current search result card based on source and state. */
  get customResultLabel(): string {
    if (!this.customResult) return '';
    const source = String(this.customResult.sourceType || this.customResult.source || '').toLowerCase();
    if (source === 'verified_seed' || source === 'prebuilt' || source === 'seed') {
      return 'Matched from Verified Seed';
    }
    if (source === 'ai' || source === 'ai_generated' || source === 'user_asked') {
      return this.customResult.stored ? 'AI Answer — Saved to Bank' : 'AI Generated';
    }
    return 'Matched from Question Bank';
  }

  /** Human-readable label for the current search state indicator bar. */
  get searchStateLabel(): string {
    switch (this.searchState) {
      case 'searching':     return 'Searching question bank…';
      case 'match-db':      return 'Matched from question bank';
      case 'match-seed':    return 'Matched from verified seed';
      case 'no-match':      return 'No match found — ask AI for an answer';
      case 'ai-generating': return 'Generating AI answer…';
      case 'ai-done':       return 'AI answer saved to question bank';
      case 'ai-reused':     return 'Answer reused from question bank';
      case 'error':         return 'An error occurred';
      default:              return '';
    }
  }

  /** CSS modifier class for the search state badge. */
  get searchStateMod(): string {
    return this.searchState;
  }

  get suggestedWeakSkill(): string | null {
    const topicCounts = new Map<string, number>();
    for (const entry of this.viewedEntries) {
      if (!entry.topicKey) continue;
      topicCounts.set(entry.topicKey, (topicCounts.get(entry.topicKey) || 0) + 1);
    }
    if (topicCounts.size === 0) return null;

    let leastViewedTopic = '';
    let leastViewedCount = Infinity;
    for (const skillKey of this.skills) {
      const count = topicCounts.get(skillKey) || 0;
      if (count < leastViewedCount) {
        leastViewedCount = count;
        leastViewedTopic = skillKey;
      }
    }
    return leastViewedTopic && leastViewedTopic !== this.activeCatalogSkill ? leastViewedTopic : null;
  }

  // ── Tab / filter events ──

  onTabChange(tab: InterviewTab): void {
    if (this.activeTab === tab) return;

    this.activeTab = tab;
    this.openAnswers.clear();
    this.errorMessage = '';

    if (tab === 'search') {
      this.fetchAllQuestions(true);
    } else if (tab === 'ai') {
      this.loadHistory();
    }

    this.cdr.markForCheck();
  }

  onSkillChange(): void {
    this.localQuestionSkill = '';
    this.resetQuestionSearchState();
    this.generatedQuestions = [];
    this.aiGeneratedCount = 0;
    this.currentSource = '';
    this.prepService.invalidate(['top', 'all', 'search', 'ask', 'generate']);
    this.filtersDirty = false;
    this.fetchTopQuestions(true);
    this.fetchAllQuestions(true);
    this.cdr.markForCheck();
  }

  onLocalQuestionSkillChange(): void {
    this.resetQuestionSearchState(false);
    this.customErrorMessage = '';
    this.cdr.markForCheck();
  }

  onAiSkillChange(): void {
    this.markFiltersChanged(false);
    this.generatedQuestions = [];
    this.aiGeneratedCount = 0;
    this.currentSource = '';
    this.errorMessage = '';
    this.cdr.markForCheck();
  }

  applyFilters(): void {
    if (this.isApplyingFilters) return; // in-flight guard
    this.openAnswers.clear();
    this.filtersDirty = false;
    this.isApplyingFilters = true;
    this.prepService.invalidate(['top', 'all']);
    this.fetchTopQuestions(true);
    this.fetchAllQuestions(true);
    this.cdr.markForCheck();
  }

  resetFilters(): void {
    this.selectedSkill = '';
    this.localQuestionSkill = '';
    this.selectedDifficulty = '';
    this.selectedCategory = '';
    this.selectedSource = '';
    this.tagsInput = '';
    this.customQuestion = '';
    this.aiPromptQuery = '';
    this.aiDifficulty = '';
    this.practiceCount = 5;
    this.resetQuestionSearchState();
    this.generatedQuestions = [];
    this.aiGeneratedCount = 0;
    this.currentSource = '';
    this.errorMessage = '';
    this.filtersDirty = false;
    this.isApplyingFilters = false;
    this.searchState = 'idle';
    this.prepService.invalidate(['top', 'all', 'search', 'ask', 'generate']);
    this.fetchTopQuestions(true);
    this.fetchAllQuestions(true);
    this.cdr.markForCheck();
  }

  // ── Pagination ──

  loadMore(): void {
    if (!this.canLoadMore) return;
    this.topPage += 1;
    this.cdr.markForCheck();
  }

  previousTopPage(): void {
    if (this.topPage <= 1) return;
    this.topPage -= 1;
    this.cdr.markForCheck();
  }

  nextTopPage(): void {
    this.loadMore();
  }

  previousAllPage(): void {
    if (this.allVisiblePage <= 1 || this.isLoadingAll) return;
    this.allVisiblePage -= 1;
    this.cdr.markForCheck();
  }

  nextAllPage(): void {
    if (this.allVisiblePage < this.allTotalPages) {
      this.allVisiblePage += 1;
      this.cdr.markForCheck();
      return;
    }
    if (this.canLoadMoreAll) {
      this.fetchAllQuestions(false);
    }
  }

  // ── Search & Ask ──

  onQuestionDraftChange(value: string): void {
    this.customQuestion = value;
    this.searchAttempted = false;
    this.canAskAI = false;
    this.searchMatches = [];
    this.customErrorMessage = '';
    this.searchState = 'idle';
    this.markFiltersChanged(false);
  }

  /**
   * Search the stored question bank first.
   * Guard: isSearchingMatches prevents duplicate in-flight requests.
   */
  searchStoredQuestions(): void {
    const query = this.customQuestion.replace(/\s+/g, ' ').trim();
    const validationMessage = this.validateQuestionAgainstSkill(query, 3);
    if (validationMessage || this.isSearchingMatches) {
      this.customErrorMessage = validationMessage;
      this.cdr.markForCheck();
      return;
    }

    if (this.customResult) {
      this.addRecentQuestion(this.customResult);
    }

    // Set all guard flags synchronously before any async work.
    this.isSearchingMatches = true;
    this.searchAttempted = true;
    this.canAskAI = false;
    this.customResult = null;
    this.searchMatches = [];
    this.searchMatchPage = 1;
    this.searchMatchTotal = 0;
    this.searchMatchesExhausted = false;
    this.customErrorMessage = '';
    this.searchState = 'searching';
    this.cdr.markForCheck();

    const sub = this.prepService.searchQuestions({
      q: query,
      skill: this.effectiveQuestionSkill,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.parseTags(),
      page: 1,
      limit: 5,
      lookupOnly: true
    }).subscribe({
      next: (response) => {
        const matches = response.questions || [];
        this.searchMatches = matches;
        this.searchMatchTotal = Number(response.total || matches.length);
        this.searchMatchesExhausted = matches.length < 5;
        this.customResult = matches[0] || null;

        if (this.customResult) {
          const src = String(this.customResult.sourceType || this.customResult.source || '').toLowerCase();
          this.searchState = (src === 'verified_seed' || src === 'prebuilt' || src === 'seed')
            ? 'match-seed'
            : 'match-db';
          this.sessionDbLookupCount += 1;
          this.addRecentQuestion(this.customResult);
          this.recordQuestionViewed(this.customResult, false);
          this.allQuestions = this.dedupeAndPrepend([this.customResult], this.allQuestions);
        } else {
          this.searchState = 'no-match';
        }
        this.canAskAI = !this.customResult;
        this.customErrorMessage = '';
        this.isSearchingMatches = false;
        this.filtersDirty = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.customErrorMessage = error?.error?.message || 'Search failed. Please try again.';
        this.canAskAI = true;
        this.searchState = 'error';
        this.isSearchingMatches = false;
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.add(sub);
  }

  /**
   * Load the next page of search matches from the backend.
   * Guard: isSearchingMatches / searchMatchesExhausted prevent duplicate calls.
   */
  loadMoreSearchMatches(): void {
    if (this.isSearchingMatches || this.searchMatchesExhausted) return;
    const query = this.customQuestion.replace(/\s+/g, ' ').trim();
    if (!query || !this.effectiveQuestionSkill) return;

    this.isSearchingMatches = true;
    this.cdr.markForCheck();

    const sub = this.prepService.searchQuestions({
      q: query,
      skill: this.effectiveQuestionSkill,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.parseTags(),
      page: this.searchMatchPage + 1,
      limit: 5,
      lookupOnly: true
    }).subscribe({
      next: (response) => {
        const matches = response.questions || [];
        if (matches.length > 0) {
          this.searchMatchPage += 1;
          this.searchMatches = [...this.searchMatches, ...matches];
        }
        this.searchMatchesExhausted = matches.length < 5;
        this.isSearchingMatches = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.isSearchingMatches = false;
        this.searchMatchesExhausted = true;
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.add(sub);
  }

  /**
   * Ask AI for an answer — only called after searchStoredQuestions confirms no DB match.
   * Guard: isAskingQuestion prevents duplicate in-flight requests.
   */
  askCustomQuestion(): void {
    const question = this.customQuestion.replace(/\s+/g, ' ').trim();
    const validationMessage = this.validateQuestionAgainstSkill(question, 12);
    if (validationMessage || this.isAskingQuestion) {
      this.customErrorMessage = validationMessage;
      this.cdr.markForCheck();
      return;
    }

    if (this.customResult) {
      this.addRecentQuestion(this.customResult);
    }

    // Set guard synchronously.
    this.isAskingQuestion = true;
    this.searchState = 'ai-generating';
    this.customErrorMessage = '';
    this.canAskAI = false;
    this.customResult = null;
    this.cdr.markForCheck();

    const sub = this.prepService.askQuestion({ question, skill: this.effectiveQuestionSkill }).subscribe({
      next: (response) => {
        this.customResult = response;
        this.addRecentQuestion(response);
        if (response.stored) {
          this.sessionAiNewCount += 1;
          this.searchState = 'ai-done';
          this.allQuestions = this.dedupeAndPrepend([response], this.allQuestions);
        } else if (response.duplicate || response.fromCache) {
          this.sessionDbLookupCount += 1;
          this.searchState = 'ai-reused';
        } else {
          this.searchState = 'ai-done';
        }
        this.recordQuestionViewed(response, true);
        this.searchMatches = [];
        this.isAskingQuestion = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.customErrorMessage = error?.error?.message || 'Failed to answer this question.';
        this.searchState = 'error';
        this.isAskingQuestion = false;
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.add(sub);
  }

  /** Generate AI practice set. Guard: isGeneratingAI prevents duplicate calls. */
  generateAIQuestions(): void {
    if (!this.canGenerateAIQuestions || this.isGeneratingAI) return;

    const trimmedFocus = this.aiPromptQuery.replace(/\s+/g, ' ').trim();

    this.isGeneratingAI = true;
    this.errorMessage = '';
    this.aiGeneratedCount = 0;
    this.currentSource = '';
    this.cdr.markForCheck();

    const sub = this.prepService.generateQuestions({
      skill: this.selectedSkill,
      query: trimmedFocus,
      difficulty: this.aiDifficulty,
      page: 1,
      limit: this.practiceCount,
      target: this.practiceCount
    }).subscribe({
      next: (response) => {
        const aiGenCount = Number(response.aiGeneratedCount || 0);
        this.generatedQuestions = Array.isArray(response.questions) ? response.questions : [];
        this.aiGeneratedCount = aiGenCount;
        this.currentSource = String(response.source || 'db');
        if (aiGenCount > 0) {
          this.sessionAiNewCount += aiGenCount;
        } else {
          this.sessionAiHitCount += this.generatedQuestions.length;
        }
        this.allQuestions = this.dedupeAndPrepend(this.generatedQuestions, this.allQuestions);
        this.isGeneratingAI = false;
        this.openAnswers.clear();
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Failed to generate interview questions.';
        this.isGeneratingAI = false;
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.add(sub);
  }

  // ── Data fetching ──

  fetchTopQuestions(reset: boolean): void {
    this.isLoading = reset;
    this.isLoadingMore = !reset;
    this.errorMessage = '';
    this.cdr.markForCheck();

    const sub = this.prepService.getTopQuestions({
      skill: this.activeCatalogSkill,
      page: 1,
      limit: this.topQuestionLimit,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.parseTags()
    }).subscribe({
      next: (response) => {
        this.consumeResponse(response, true);
        this.topPage = 1;
        this.checkApplyingFilters();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Failed to load interview questions.';
        this.isLoading = false;
        this.isLoadingMore = false;
        this.checkApplyingFilters();
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.add(sub);
  }

  fetchAllQuestions(reset: boolean): void {
    const page = reset ? 1 : this.allBatchPage + 1;
    this.fetchAllQuestionsPage(page, reset);
  }

  fetchAllQuestionsPage(page: number, reset = true): void {
    this.isLoadingAll = reset;
    this.isLoadingAllMore = !reset;
    this.errorMessage = '';
    this.cdr.markForCheck();

    const sub = this.prepService.getAllQuestions({
      skill: this.activeCatalogSkill,
      page,
      limit: this.allQuestionBatchLimit,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.parseTags(),
      category: this.selectedCategory || undefined,
      source: this.selectedSource || undefined
    }).subscribe({
      next: (response) => {
        const incoming = Array.isArray(response.questions) ? response.questions : [];
        this.allQuestions = reset ? incoming : [...this.allQuestions, ...incoming];
        this.allTotal = Number(response.total || this.allQuestions.length);
        this.allBatchPage = Number(response.page || page);
        this.allVisiblePage = reset ? 1 : Math.ceil(this.allQuestions.length / this.pageSize);
        this.isLoadingAll = false;
        this.isLoadingAllMore = false;
        this.filtersDirty = false;
        this.checkApplyingFilters();
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Failed to load all interview questions.';
        this.isLoadingAll = false;
        this.isLoadingAllMore = false;
        this.checkApplyingFilters();
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.add(sub);
  }

  /** Load real history from backend. De-duped by historyLoaded flag; force=true bypasses. */
  loadHistory(force = false): void {
    if (this.historyLoaded && !force) return;
    this.isLoadingHistory = true;
    this.cdr.markForCheck();

    const sub = this.prepService.getHistory(10).subscribe({
      next: (questions) => {
        this.historyQuestions = questions;
        this.historyLoaded = true;
        this.isLoadingHistory = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.historyQuestions = [];
        this.historyLoaded = true;
        this.isLoadingHistory = false;
        this.cdr.markForCheck();
      }
    });
    this.subscriptions.add(sub);
  }

  /** Resets isApplyingFilters once both Top 30 and All fetches are done. */
  private checkApplyingFilters(): void {
    if (!this.isLoading && !this.isLoadingAll) {
      this.isApplyingFilters = false;
    }
  }

  // ── Viewed / mastery tracking ──

  private loadViewedEntries(): ViewedEntry[] {
    try {
      const raw = localStorage.getItem(VIEWED_QUESTIONS_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      const cutoff = Date.now() - VIEWED_TTL_MS;
      // Prune entries older than 30 days.
      return (parsed as ViewedEntry[])
        .filter(e => e && typeof e.viewedAt === 'number' && e.viewedAt > cutoff)
        .slice(0, MAX_VIEWED_ENTRIES);
    } catch {
      return [];
    }
  }

  private persistViewedEntries(): void {
    try {
      const trimmed = this.viewedEntries.slice(0, MAX_VIEWED_ENTRIES);
      localStorage.setItem(VIEWED_QUESTIONS_KEY, JSON.stringify(trimmed));
    } catch {
      // storage full or unavailable — silently discard
    }
  }

  recordQuestionViewed(item: InterviewQuestion, answerVisible: boolean): void {
    const id = item._id || item.question;
    const existing = this.viewedEntries.findIndex(
      (entry) => entry.questionId === id || entry.question === item.question
    );
    if (existing >= 0) {
      this.viewedEntries[existing].viewedAt = Date.now();
      this.viewedEntries[existing].answerViewed = this.viewedEntries[existing].answerViewed || answerVisible;
    } else {
      this.viewedEntries.push({
        questionId: id,
        question: item.question,
        topicKey: item.topicKey || this.effectiveQuestionSkill || this.activeCatalogSkill,
        viewedAt: Date.now(),
        answerViewed: answerVisible
      });
    }
    if (item.topicKey) {
      this.viewedTopicKeys.add(item.topicKey);
    }
    this.persistViewedEntries();
  }

  countViewedForTopic(topicKey: string): number {
    return this.viewedEntries.filter((entry) => entry.topicKey === topicKey).length;
  }

  countAnswerViewedForTopic(topicKey: string): number {
    return this.viewedEntries.filter((entry) => entry.topicKey === topicKey && entry.answerViewed).length;
  }

  isLowConfidence(item: InterviewQuestion): boolean {
    return (
      Number(item.confidenceScore || 0) > 0 &&
      Number(item.confidenceScore) < LOW_CONFIDENCE_WARN_THRESHOLD &&
      (item.sourceType === 'ai' || item.sourceType === 'ai_generated' || item.sourceType === 'scraped')
    );
  }

  // ── Private data helpers ──

  private dedupeAndPrepend(newItems: InterviewQuestion[], existing: InterviewQuestion[]): InterviewQuestion[] {
    const newKeys = new Set(newItems.map((item) => item._id || item.question));
    return [
      ...newItems,
      ...existing.filter((item) => !newKeys.has(item._id || item.question))
    ];
  }

  private consumeResponse(response: InterviewQuestionListResponse, reset: boolean): void {
    const previousCount = this.questions.length;
    const previousTotalPages = this.totalPages;
    const incoming = Array.isArray(response.questions) ? response.questions : [];
    this.questions = reset ? incoming : [...this.questions, ...incoming];
    this.total = Number(response.total || this.questions.length);
    this.currentPage = Number(response.page || 1);
    this.totalPages = Number(response.totalPages || 1);
    this.currentSource = String(response.source || this.currentSource || 'db');
    this.recomputeHighlights();

    if (reset) {
      this.allowEnrichmentLoadMore = true;
    } else {
      const grewByCount = this.questions.length > previousCount;
      const grewByPages = this.totalPages > previousTotalPages;
      if (grewByCount || grewByPages) {
        this.allowEnrichmentLoadMore = true;
      } else if (this.currentPage >= this.totalPages) {
        this.allowEnrichmentLoadMore = false;
      }
    }

    this.isLoading = false;
    this.isLoadingMore = false;
    this.cdr.markForCheck();
  }

  private parseTags(): string[] {
    return this.tagsInput
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);
  }

  private normalizeSkillMatchText(value: string): string {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/\+/g, ' plus ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private detectMentionedSkills(question: string): string[] {
    const normalizedQuestion = this.normalizeSkillMatchText(question);
    if (!normalizedQuestion) return [];

    const haystack = ` ${normalizedQuestion} `;
    return this.skills.filter((skill) => {
      const aliases = SKILL_MATCH_ALIASES[skill] || [skill];
      return aliases.some((alias) => {
        const normalizedAlias = this.normalizeSkillMatchText(alias);
        return normalizedAlias && haystack.includes(` ${normalizedAlias} `);
      });
    });
  }

  private validateQuestionAgainstSkill(question: string, minimumLength: number): string {
    const normalizedQuestion = String(question || '').replace(/\s+/g, ' ').trim();
    if (!this.effectiveQuestionSkill) {
      return 'Please select a skill';
    }
    if (normalizedQuestion.length < minimumLength) {
      return minimumLength >= 12
        ? 'Enter a complete interview question (at least 12 characters).'
        : 'Enter at least 3 characters to search the question bank.';
    }

    const detectedSkills = this.detectMentionedSkills(normalizedQuestion);
    if (detectedSkills.length > 0 && !detectedSkills.includes(this.effectiveQuestionSkill)) {
      return `This question does not match the selected skill. It looks closer to ${this.getSkillLabel(detectedSkills[0])}.`;
    }
    return '';
  }

  private escapeHtml(value: string): string {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private escapeRegExp(value: string): string {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private recomputeHighlights(): void {
    const pattern = null;
    const questions: SafeHtml[] = [];
    const answers: SafeHtml[] = [];

    for (const item of this.questions) {
      const safeQuestion = this.escapeHtml(item.question);
      const safeAnswer = this.escapeHtml(item.answer || '');
      const highlightedQuestion = pattern ? safeQuestion.replace(pattern, '<mark>$1</mark>') : safeQuestion;
      const highlightedAnswer = pattern ? safeAnswer.replace(pattern, '<mark>$1</mark>') : safeAnswer;
      questions.push(this.sanitizer.bypassSecurityTrustHtml(highlightedQuestion));
      answers.push(this.sanitizer.bypassSecurityTrustHtml(highlightedAnswer));
    }

    this.highlightedQuestions = questions;
    this.highlightedAnswers = answers;
  }

  // ── Answer toggle ──

  getQuestionKey(question: any): string {
    if (!question) return '';
    return question._id || question.id || question.normalizedQuestionHash || question.canonicalQuestionKey || question.question;
  }

  toggleAnswer(item: InterviewQuestion): void {
    const key = this.getQuestionKey(item);
    if (!key) return;

    const isCurrentlyOpen = this.openAnswers.has(key);
    if (isCurrentlyOpen) {
      this.openAnswers.delete(key);
    } else {
      this.openAnswers.add(key);
      this.recordQuestionViewed(item, true);
    }
  }

  isExpanded(item: InterviewQuestion): boolean {
    const key = this.getQuestionKey(item);
    return !!key && this.openAnswers.has(key);
  }

  getAbsoluteTopIndex(i: number): number {
    return (this.topPage - 1) * this.pageSize + i;
  }

  getAbsoluteAllIndex(i: number): number {
    return (this.allVisiblePage - 1) * this.pageSize + i;
  }

  // ── Display helpers ──

  sourceLabel(item: InterviewQuestion): string {
    if (item.sourceLabel) return item.sourceLabel;
    const source = String(item.sourceType || item.source || 'db').toLowerCase();
    if (source === 'verified_seed' || source === 'prebuilt' || source === 'seed') return 'Verified Seed';
    if (source === 'scraped' || source === 'scrape') return 'Scraped';
    if (source === 'ai' || source === 'ai_generated' || source === 'user_asked') return 'AI Generated';
    if (source === 'hybrid') return 'Hybrid';
    return 'Database';
  }

  confidenceLabel(item: InterviewQuestion): string {
    const value = Number(item.confidenceScore || 0);
    if (value <= 0) return '';
    const percent = Math.round(value * 100);
    if (value < LOW_CONFIDENCE_WARN_THRESHOLD) return `${percent}% confidence ⚠`;
    return `${percent}% confidence`;
  }

  relevanceLabel(item: InterviewQuestion): string {
    const value = Number(item.relevanceScore || 0);
    return value > 0 ? `${Math.round(value * 100)}% relevance` : '';
  }

  async copyAnswer(item: InterviewQuestion): Promise<void> {
    try {
      await navigator.clipboard.writeText(`${item.question}\n\n${item.answer}`);
      this.copyMessage = 'Answer copied.';
    } catch {
      this.copyMessage = 'Unable to copy answer.';
    }
    this.cdr.markForCheck();
    setTimeout(() => {
      this.copyMessage = '';
      this.cdr.markForCheck();
    }, 2500);
  }

  clearCurrentQuestion(): void {
    if (this.customResult) {
      this.addRecentQuestion(this.customResult);
    }
    this.customResult = null;
    this.customQuestion = '';
    this.searchMatches = [];
    this.customErrorMessage = '';
    this.searchState = 'idle';
    this.cdr.markForCheck();
  }

  useStoredQuestion(item: InterviewQuestion): void {
    this.customQuestion = item.question;
    if (this.customResult) {
      this.addRecentQuestion(this.customResult);
    }
    this.customResult = item;
    const src = String(item.sourceType || item.source || '').toLowerCase();
    this.searchState = (src === 'verified_seed' || src === 'prebuilt' || src === 'seed')
      ? 'match-seed'
      : 'match-db';
    this.addRecentQuestion(item);
    this.canAskAI = false;
    this.searchAttempted = true;
    this.recordQuestionViewed(item, false);
    this.cdr.markForCheck();
  }

  trackByQuestion(_index: number, item: InterviewQuestion): string {
    return item._id || item.question;
  }

  getSkillLabel(skill: string): string {
    return SKILL_LABELS[skill] || skill;
  }

  get personalizedContext(): string {
    const profile = this.careerProfileService.snapshot;
    return `${profile.careerStack} | ${profile.experienceLevel}`;
  }

  get selectedTopicLabel(): string {
    return this.getSkillLabel(this.activeCatalogSkill);
  }

  get activeFilterChips(): string[] {
    return [
      this.selectedSkill ? this.getSkillLabel(this.selectedSkill) : '',
      this.activeTab === 'ai'
        ? (this.aiDifficulty ? `${this.aiDifficulty} difficulty` : '')
        : (this.selectedDifficulty ? `${this.selectedDifficulty} difficulty` : ''),
      this.activeTab === 'search' && this.selectedCategory ? `Category: ${this.selectedCategory.replace('_', ' ')}` : '',
      this.activeTab === 'search' && this.selectedSource ? `Source: ${this.selectedSource}` : '',
      ...(this.activeTab === 'search' ? this.parseTags().map((tag) => `#${tag}`) : []),
      this.activeTab === 'search' && this.customQuestion.trim() ? `"${this.customQuestion.trim()}"` : '',
      this.activeTab === 'ai' && this.aiPromptQuery.trim() ? `Focus: ${this.aiPromptQuery.trim()}` : '',
      this.activeTab === 'ai' ? `Count: ${this.practiceCount}` : ''
    ].filter(Boolean);
  }

  // ── Answer rendering ──

  answerSection(item: InterviewQuestion, title: string): string {
    const direct = item.answerSections?.[title] || item.answerSections?.[title.charAt(0).toLowerCase() + title.slice(1)];
    if (typeof direct === 'string') return direct;
    const allTitles = this.answerSectionTitles.join('|');
    const section = new RegExp(`${title}:\\s*([\\s\\S]*?)(?=\\n(?:${allTitles}|Direct answer|Example or code snippet):|$)`, 'i');
    return item.answer.match(section)?.[1]?.trim() || '';
  }

  answerSections(item: InterviewQuestion): AnswerSection[] {
    const structured = item.answerSections || {};
    const sections: AnswerSection[] = [];

    const shortAnswer = typeof structured.shortAnswer === 'string' && structured.shortAnswer
      ? structured.shortAnswer
      : typeof structured.summary === 'string' ? structured.summary : '';
    if (shortAnswer) sections.push({ title: 'Short Answer', body: shortAnswer });

    const keyPoints = Array.isArray(structured.keyPoints) && structured.keyPoints.length
      ? structured.keyPoints
      : Array.isArray(structured.bulletPoints) ? structured.bulletPoints : [];
    if (keyPoints.length) sections.push({ title: 'Key Points', body: '', kind: 'list', items: keyPoints });

    if (typeof structured.explanation === 'string' && structured.explanation) {
      sections.push({ title: 'Explanation', body: structured.explanation });
    }

    const example = typeof structured.example === 'string' && structured.example
      ? structured.example
      : typeof structured.codeExample === 'string' ? structured.codeExample : '';
    if (example) sections.push({ title: 'Example', body: example, kind: 'code' });

    const realWorldUseCase = typeof structured.realWorldUseCase === 'string' && structured.realWorldUseCase
      ? structured.realWorldUseCase
      : typeof structured.realWorldContext === 'string' ? structured.realWorldContext : '';
    if (realWorldUseCase) sections.push({ title: 'Real-world Use Case', body: realWorldUseCase, kind: 'context' });

    const commonMistakes = structured['commonMistakes'];
    if (Array.isArray(commonMistakes) && commonMistakes.length) {
      sections.push({ title: 'Common Mistakes', body: '', kind: 'list', items: commonMistakes });
    }

    const interviewTip = structured['interviewTip'];
    if (typeof interviewTip === 'string' && interviewTip) {
      sections.push({ title: 'Interview Tip', body: interviewTip, kind: 'context' });
    }

    if (sections.length) return sections;

    // Legacy plain-text answer fallback.
    const legacySections = this.answerSectionTitles
      .map((title) => ({ title, body: this.answerSection(item, title), kind: 'text' as const }))
      .filter((section) => section.body);
    if (legacySections.length) return legacySections;

    // Final fallback: render the full answer as a single block (only if non-empty).
    return item.answer ? [{ title: 'Answer', body: item.answer }] : [];
  }

  markFiltersChanged(clearResults = true): void {
    this.filtersDirty = true;
    this.openAnswers.clear();
    if (clearResults) {
      this.questions = [];
      this.recomputeHighlights();
      this.topPage = 1;
      this.allQuestions = [];
      this.allBatchPage = 1;
      this.allVisiblePage = 1;
      this.allTotal = 0;
      this.total = 0;
      this.currentPage = 1;
      this.totalPages = 1;
      this.generatedQuestions = [];
      this.aiGeneratedCount = 0;
      this.currentSource = '';
      this.searchMatches = [];
      this.searchAttempted = false;
      this.canAskAI = false;
      this.customResult = null;
      this.searchState = 'idle';
    }
    this.cdr.markForCheck();
  }

  private resetQuestionSearchState(clearQuestion = false): void {
    if (clearQuestion) this.customQuestion = '';
    this.searchMatches = [];
    this.searchAttempted = false;
    this.canAskAI = false;
    this.customResult = null;
    this.customErrorMessage = '';
    this.searchState = 'idle';
  }

  private addRecentQuestion(item: InterviewQuestion): void {
    const key = item._id || item.question;
    this.recentQuestions = [
      item,
      ...this.recentQuestions.filter((recent) => (recent._id || recent.question) !== key)
    ].slice(0, 8);
  }
}
