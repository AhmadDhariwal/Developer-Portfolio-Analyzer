import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { InterviewPrepService, InterviewQuestion, InterviewQuestionListResponse } from '../../shared/services/interview-prep.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';

type InterviewTab = 'top' | 'search' | 'ai';

@Component({
  selector: 'app-interview-prep',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './interview-prep.component.html',
  styleUrl: './interview-prep.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class InterviewPrepComponent implements OnInit {
  readonly pageSize = 10;
  readonly topQuestionLimit = 30;
  readonly skills = [
    'javascript',
    'typescript',
    'python',
    'java',
    'cpp',
    'angular',
    'react',
    'nodejs',
    'expressjs',
    'nextjs',
    'mongodb',
    'mysql',
    'postgresql',
    'redis',
    'rest-apis',
    'graphql',
    'system-design',
    'mern',
    'mean',
    'full-stack-web-development'
  ];
  readonly tabs: Array<{ id: InterviewTab; label: string }> = [
    { id: 'top', label: 'Top Questions' },
    { id: 'search', label: 'Search / Ask' },
    { id: 'ai', label: 'AI Generated' }
  ];
  readonly skillLabels: Record<string, string> = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    java: 'Java',
    cpp: 'C++',
    angular: 'Angular',
    react: 'React',
    nodejs: 'Node.js',
    expressjs: 'Express.js',
    nextjs: 'Next.js',
    mongodb: 'MongoDB',
    mysql: 'MySQL',
    postgresql: 'PostgreSQL',
    redis: 'Redis',
    'rest-apis': 'REST APIs',
    graphql: 'GraphQL',
    'system-design': 'System Design',
    mern: 'MERN',
    mean: 'MEAN',
    'full-stack-web-development': 'Full Stack Web Development'
  };

  activeTab: InterviewTab = 'top';
  selectedSkill = 'javascript';
  selectedDifficulty = '';
  tagsInput = '';
  aiPromptQuery = '';
  practiceCount = 10;
  customQuestion = '';
  customResult: InterviewQuestion | null = null;
  searchMatches: InterviewQuestion[] = [];
  searchAttempted = false;
  canAskAI = false;
  recentQuestions: InterviewQuestion[] = [];
  generatedQuestions: InterviewQuestion[] = [];
  filtersDirty = false;
  customErrorMessage = '';
  isAskingQuestion = false;
  isSearchingMatches = false;
  copyMessage = '';

  questions: InterviewQuestion[] = [];
  total = 0;
  currentPage = 1;
  totalPages = 1;

  isLoading = false;
  isLoadingMore = false;
  isGeneratingAI = false;
  errorMessage = '';

  aiGeneratedCount = 0;
  currentSource = '';
  allowEnrichmentLoadMore = true;

  openAnswers = new Set<number>();
  skeletonItems = Array.from({ length: 6 });
  highlightedQuestions: SafeHtml[] = [];
  highlightedAnswers: SafeHtml[] = [];
  readonly answerSectionTitles = [
    'Short direct answer',
    'Key points',
    'Explanation',
    'Example',
    'Real-world use case',
    'Common mistakes',
    'Interview tip'
  ];

  constructor(
    private readonly prepService: InterviewPrepService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef,
    private readonly sanitizer: DomSanitizer
  ) {}

  ngOnInit(): void {
    this.selectedSkill = this.mapCareerProfileToSkill(this.careerProfileService.snapshot.careerStack);
    this.fetchTopQuestions(true);
  }

  get canLoadMore(): boolean {
    if (this.isLoadingMore || this.isLoading) return false;
    if (this.activeTab !== 'top') return false;
    if (this.currentPage < this.totalPages) return true;
    return this.allowEnrichmentLoadMore && this.hasQuestions;
  }

  get hasQuestions(): boolean {
    return this.questions.length > 0;
  }

  onTabChange(tab: InterviewTab): void {
    if (this.activeTab === tab) return;

    this.activeTab = tab;
    this.openAnswers.clear();
    this.errorMessage = '';

    if (tab === 'top') {
      this.fetchTopQuestions(true);
    } else if (tab === 'search') {
      this.questions = [];
      this.recomputeHighlights();
      this.total = 0;
      this.currentPage = 1;
      this.totalPages = 1;
    } else {
      this.questions = [...this.generatedQuestions];
      this.recomputeHighlights();
      this.total = this.questions.length;
      this.currentPage = 1;
      this.totalPages = 1;
    }

    this.cdr.markForCheck();
  }

  onSkillChange(): void {
    this.markFiltersChanged();
  }

  applyFilters(): void {
    this.openAnswers.clear();
    this.filtersDirty = false;
    if (this.activeTab === 'top') {
      this.fetchTopQuestions(true);
      return;
    }
    if (this.activeTab === 'search') {
      this.searchStoredQuestions();
      return;
    }
    this.questions = [...this.generatedQuestions];
    this.recomputeHighlights();
    this.cdr.markForCheck();
  }

  clearFilters(): void {
    this.selectedDifficulty = '';
    this.tagsInput = '';
    this.customQuestion = '';
    this.aiPromptQuery = '';
    this.searchMatches = [];
    this.searchAttempted = false;
    this.canAskAI = false;
    this.customResult = null;
    this.applyFilters();
  }

  loadMore(): void {
    if (!this.canLoadMore) return;
    if (this.activeTab === 'top') {
      this.fetchTopQuestions(false);
      return;
    }
  }

  onQuestionDraftChange(value: string): void {
    this.customQuestion = value;
    this.searchAttempted = false;
    this.canAskAI = false;
    this.searchMatches = [];
    this.customErrorMessage = '';
    this.markFiltersChanged(false);
  }

  generateAIQuestions(): void {
    if (!this.selectedSkill || this.isGeneratingAI) return;

    this.isGeneratingAI = true;
    this.errorMessage = '';
    this.aiGeneratedCount = 0;
    this.currentSource = '';
    this.cdr.markForCheck();

    this.prepService.generateQuestions({
      skill: this.selectedSkill,
      query: this.aiPromptQuery.trim(),
      difficulty: this.selectedDifficulty || undefined,
      page: 1,
      limit: this.practiceCount
    }).subscribe({
      next: (response) => {
        this.consumeResponse(response, true);
        this.generatedQuestions = [...this.questions];
        this.aiGeneratedCount = Number(response.aiGeneratedCount || 0);
        this.currentSource = String(response.source || 'db');
        this.isGeneratingAI = false;
        this.activeTab = 'ai';
        this.openAnswers.clear();
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Failed to generate interview questions.';
        this.isGeneratingAI = false;
        this.cdr.markForCheck();
      }
    });
  }

  askCustomQuestion(): void {
    const question = this.customQuestion.replace(/\s+/g, ' ').trim();
    if (question.length < 12 || this.isAskingQuestion) {
      this.customErrorMessage = question.length < 12 ? 'Enter a complete interview question (at least 12 characters).' : '';
      this.cdr.markForCheck();
      return;
    }

    if (this.customResult) {
      this.addRecentQuestion(this.customResult);
    }

    this.isAskingQuestion = true;
    this.customErrorMessage = '';
    this.canAskAI = false;
    this.customResult = null;
    this.cdr.markForCheck();

    this.prepService.askQuestion({ question, skill: this.selectedSkill }).subscribe({
      next: (response) => {
        this.customResult = response;
        this.searchMatches = [];
        this.isAskingQuestion = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.customErrorMessage = error?.error?.message || 'Failed to answer this question.';
        this.isAskingQuestion = false;
        this.cdr.markForCheck();
      }
    });
  }

  fetchTopQuestions(reset: boolean): void {
    const page = reset ? 1 : this.currentPage + 1;
    this.isLoading = reset;
    this.isLoadingMore = !reset;
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.prepService.getTopQuestions({
      skill: this.selectedSkill,
      page,
      limit: this.topQuestionLimit,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.parseTags()
    }).subscribe({
      next: (response) => {
        this.consumeResponse(response, reset);
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Failed to load interview questions.';
        this.isLoading = false;
        this.isLoadingMore = false;
        this.cdr.markForCheck();
      }
    });
  }

  searchStoredQuestions(): void {
    const query = this.customQuestion.replace(/\s+/g, ' ').trim();
    if (query.length < 3 || this.isSearchingMatches) {
      this.customErrorMessage = query.length < 3 ? 'Enter at least 3 characters to search the question bank.' : '';
      this.cdr.markForCheck();
      return;
    }

    if (this.customResult) {
      this.addRecentQuestion(this.customResult);
    }

    this.isSearchingMatches = true;
    this.searchAttempted = true;
    this.canAskAI = false;
    this.customResult = null;
    this.searchMatches = [];
    this.customErrorMessage = '';
    this.cdr.markForCheck();

    this.prepService.searchQuestions({
      q: query,
      skill: this.selectedSkill,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.parseTags(),
      page: 1,
      limit: 5,
      lookupOnly: true
    }).subscribe({
      next: (response) => {
        const matches = response.questions || [];
        this.searchMatches = matches;
        this.customResult = matches[0] || null;
        this.canAskAI = matches.length === 0;
        this.isSearchingMatches = false;
        this.filtersDirty = false;
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.customErrorMessage = error?.error?.message || 'Search failed.';
        this.canAskAI = true;
        this.isSearchingMatches = false;
        this.cdr.markForCheck();
      }
    });
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

  private mapCareerProfileToSkill(careerStack: string): string {
    const normalized = String(careerStack || '').toLowerCase();
    if (normalized.includes('frontend')) return 'react';
    if (normalized.includes('backend')) return 'javascript';
    return 'mern';
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

  toggleAnswer(index: number): void {
    if (this.openAnswers.has(index)) {
      this.openAnswers.delete(index);
    } else {
      this.openAnswers.add(index);
    }
  }

  isAnswerOpen(index: number): boolean {
    return this.openAnswers.has(index);
  }

  sourceLabel(item: InterviewQuestion): string {
    if (item.sourceLabel) return item.sourceLabel;
    const source = String(item.sourceType || item.source || 'db').toLowerCase();
    if (source === 'prebuilt' || source === 'seed') return 'Seed';
    if (source === 'scraped' || source === 'scrape') return 'Scraped';
    if (source === 'ai' || source === 'user_asked') return 'AI';
    if (source === 'hybrid') return 'Hybrid';
    return 'DB';
  }

  confidenceLabel(item: InterviewQuestion): string {
    const value = Number(item.confidenceScore || 0);
    return value > 0 ? `${Math.round(value * 100)}% confidence` : '';
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
    this.cdr.markForCheck();
  }

  useStoredQuestion(item: InterviewQuestion): void {
    this.customQuestion = item.question;
    if (this.customResult) {
      this.addRecentQuestion(this.customResult);
    }
    this.customResult = item;
    this.canAskAI = false;
    this.searchAttempted = true;
    this.cdr.markForCheck();
  }

  trackByQuestion(_index: number, item: InterviewQuestion): string {
    return item._id || item.question;
  }

  getSkillLabel(skill: string): string {
    return this.skillLabels[skill] || skill;
  }

  get personalizedContext(): string {
    const profile = this.careerProfileService.snapshot;
    return `${profile.careerStack} | ${profile.experienceLevel}`;
  }

  get selectedTopicLabel(): string {
    return this.getSkillLabel(this.selectedSkill);
  }

  get activeFilterChips(): string[] {
    return [
      this.selectedTopicLabel,
      this.selectedDifficulty ? `${this.selectedDifficulty} difficulty` : '',
      ...this.parseTags().map((tag) => `#${tag}`),
      this.activeTab === 'search' && this.customQuestion.trim() ? `"${this.customQuestion.trim()}"` : '',
      this.activeTab === 'ai' && this.aiPromptQuery.trim() ? `Focus: ${this.aiPromptQuery.trim()}` : ''
    ].filter(Boolean);
  }

  answerSection(item: InterviewQuestion, title: string): string {
    const direct = item.answerSections?.[title];
    if (direct) return direct;
    const allTitles = this.answerSectionTitles.join('|');
    const section = new RegExp(`${title}:\\s*([\\s\\S]*?)(?=\\n(?:${allTitles}|Direct answer|Example or code snippet):|$)`, 'i');
    return item.answer.match(section)?.[1]?.trim() || '';
  }

  answerSections(item: InterviewQuestion): Array<{ title: string; body: string }> {
    const sections = this.answerSectionTitles
      .map((title) => ({ title, body: this.answerSection(item, title) }))
      .filter((section) => section.body);
    return sections.length ? sections : [{ title: 'Answer', body: item.answer }];
  }

  markFiltersChanged(clearResults = true): void {
    this.filtersDirty = true;
    this.openAnswers.clear();
    if (clearResults) {
      this.questions = [];
      this.recomputeHighlights();
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
    }
    this.cdr.markForCheck();
  }

  private addRecentQuestion(item: InterviewQuestion): void {
    const key = item._id || item.question;
    this.recentQuestions = [
      item,
      ...this.recentQuestions.filter((recent) => (recent._id || recent.question) !== key)
    ].slice(0, 8);
  }
}
