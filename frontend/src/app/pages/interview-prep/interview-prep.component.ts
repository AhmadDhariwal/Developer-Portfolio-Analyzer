import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { InterviewPrepService, InterviewQuestion, InterviewQuestionListResponse } from '../../shared/services/interview-prep.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';

type InterviewTab = 'search' | 'ai';
type AnswerSection = { title: string; body: string; kind?: 'text' | 'list' | 'code' | 'context'; items?: string[] };

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
  readonly allQuestionBatchLimit = 50;
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
    'html',
    'css',
    'git-github',
    'oop',
    'dsa',
    'aws',
    'generative-ai',
    'ai-agents',
    'llm',
    'rag',
    'langchain',
    'system-design',
    'mern',
    'mean',
    'full-stack-web-development'
  ];
  readonly practiceCounts = [1, 2, 3];
  readonly tabs: Array<{ id: InterviewTab; label: string }> = [
    { id: 'search', label: 'Search & Questions' },
    { id: 'ai', label: 'AI Generated & Recent' }
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
    html: 'HTML',
    css: 'CSS',
    'git-github': 'Git/GitHub',
    oop: 'OOP',
    dsa: 'DSA',
    aws: 'AWS',
    'generative-ai': 'Generative AI',
    'ai-agents': 'AI Agents',
    llm: 'LLM',
    rag: 'RAG',
    langchain: 'LangChain',
    'system-design': 'System Design',
    mern: 'Full Stack / MERN',
    mean: 'MEAN',
    'full-stack-web-development': 'Full Stack Web Development'
  };

  activeTab: InterviewTab = 'search';
  selectedSkill = 'javascript';
  selectedDifficulty = '';
  tagsInput = '';
  selectedCategory = '';
  selectedSource = '';
  aiPromptQuery = '';
  aiDifficulty = '';
  practiceCount = 3;
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
  topPage = 1;
  allQuestions: InterviewQuestion[] = [];
  allBatchPage = 1;
  allVisiblePage = 1;
  allTotal = 0;
  total = 0;
  currentPage = 1;
  totalPages = 1;

  isLoading = false;
  isLoadingMore = false;
  isLoadingAll = false;
  isLoadingAllMore = false;
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
    'Short answer',
    'Explanation',
    'Key Points',
    'Example',
    'Real-world Use Case',
    'Common Mistakes',
    'Interview Tip'
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
    this.fetchAllQuestions(true);
  }

  get canLoadMore(): boolean {
    return this.topPage < this.topTotalPages;
  }

  get canLoadMoreAll(): boolean {
    return !this.isLoadingAll && !this.isLoadingAllMore && this.allQuestions.length < this.allTotal;
  }

  get hasQuestions(): boolean {
    return this.questions.length > 0;
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
    return `${start}-${end} of ${this.questions.length}`;
  }

  get allRangeLabel(): string {
    if (!this.allTotal || !this.allQuestions.length) return '0 of 0';
    const start = (this.allVisiblePage - 1) * this.pageSize + 1;
    const end = Math.min(this.allVisiblePage * this.pageSize, this.allQuestions.length, this.allTotal);
    return `${start}-${end} of ${this.allTotal}`;
  }

  get visibleAllQuestions(): InterviewQuestion[] {
    const start = (this.allVisiblePage - 1) * this.pageSize;
    return this.allQuestions.slice(start, start + this.pageSize);
  }

  get allTotalPages(): number {
    return Math.max(1, Math.ceil(this.allQuestions.length / this.pageSize));
  }

  onTabChange(tab: InterviewTab): void {
    if (this.activeTab === tab) return;

    this.activeTab = tab;
    this.openAnswers.clear();
    this.errorMessage = '';

    if (tab === 'search') {
      this.fetchAllQuestions(true);
    }

    this.cdr.markForCheck();
  }

  onSkillChange(): void {
    this.markFiltersChanged();
  }

  applyFilters(): void {
    this.openAnswers.clear();
    this.filtersDirty = false;
    this.fetchTopQuestions(true);
    this.fetchAllQuestions(true);
    this.cdr.markForCheck();
  }

  clearFilters(): void {
    this.selectedDifficulty = '';
    this.selectedCategory = '';
    this.selectedSource = '';
    this.tagsInput = '';
    this.customQuestion = '';
    this.aiPromptQuery = '';
    this.aiDifficulty = '';
    this.practiceCount = 3;
    this.searchMatches = [];
    this.searchAttempted = false;
    this.canAskAI = false;
    this.customResult = null;
    this.applyFilters();
  }

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
      difficulty: this.aiDifficulty || undefined,
      page: 1,
      limit: this.practiceCount,
      target: this.practiceCount
    }).subscribe({
      next: (response) => {
        this.generatedQuestions = Array.isArray(response.questions) ? response.questions : [];
        this.aiGeneratedCount = Number(response.aiGeneratedCount || 0);
        this.currentSource = String(response.source || 'db');
        this.allQuestions = [
          ...this.generatedQuestions,
          ...this.allQuestions.filter((item) => !this.generatedQuestions.some((generated) => (
            (generated._id || generated.question) === (item._id || item.question)
          )))
        ];
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
      page: 1,
      limit: this.topQuestionLimit,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.parseTags()
    }).subscribe({
      next: (response) => {
        this.consumeResponse(response, true);
        this.topPage = 1;
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Failed to load interview questions.';
        this.isLoading = false;
        this.isLoadingMore = false;
        this.cdr.markForCheck();
      }
    });
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

    this.prepService.getAllQuestions({
      skill: this.selectedSkill,
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
        this.cdr.markForCheck();
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Failed to load all interview questions.';
        this.isLoadingAll = false;
        this.isLoadingAllMore = false;
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
        if (this.customResult) {
          this.allQuestions = [
            this.customResult,
            ...this.allQuestions.filter((item) => (item._id || item.question) !== (this.customResult?._id || this.customResult?.question))
          ];
        }
        this.canAskAI = !this.customResult;
        this.customErrorMessage = this.customResult ? '' : 'No exact answer found in the question bank.';
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
    if (source === 'verified_seed' || source === 'prebuilt' || source === 'seed') return 'Verified Seed';
    if (source === 'scraped' || source === 'scrape') return 'Scraped';
    if (source === 'ai' || source === 'ai_generated' || source === 'user_asked') return 'AI Generated';
    if (source === 'hybrid') return 'Hybrid';
    return 'Database';
  }

  confidenceLabel(item: InterviewQuestion): string {
    const value = Number(item.confidenceScore || 0);
    return value > 0 ? `${Math.round(value * 100)}% confidence` : '';
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
    if (shortAnswer) {
      sections.push({ title: 'Short Answer', body: shortAnswer });
    }
    const keyPoints = Array.isArray(structured.keyPoints) && structured.keyPoints.length
      ? structured.keyPoints
      : Array.isArray(structured.bulletPoints) ? structured.bulletPoints : [];
    if (keyPoints.length) {
      sections.push({ title: 'Key Points', body: '', kind: 'list', items: keyPoints });
    }
    if (typeof structured.explanation === 'string' && structured.explanation) {
      sections.push({ title: 'Explanation', body: structured.explanation });
    }
    const example = typeof structured.example === 'string' && structured.example
      ? structured.example
      : typeof structured.codeExample === 'string' ? structured.codeExample : '';
    if (example) {
      sections.push({ title: 'Example', body: example, kind: 'code' });
    }
    const realWorldUseCase = typeof structured.realWorldUseCase === 'string' && structured.realWorldUseCase
      ? structured.realWorldUseCase
      : typeof structured.realWorldContext === 'string' ? structured.realWorldContext : '';
    if (realWorldUseCase) {
      sections.push({ title: 'Real-world Use Case', body: realWorldUseCase, kind: 'context' });
    }
    const commonMistakes = structured['commonMistakes'];
    if (Array.isArray(commonMistakes) && commonMistakes.length) {
      sections.push({ title: 'Common Mistakes', body: '', kind: 'list', items: commonMistakes });
    }
    const interviewTip = structured['interviewTip'];
    if (typeof interviewTip === 'string' && interviewTip) {
      sections.push({ title: 'Interview Tip', body: interviewTip, kind: 'context' });
    }
    if (sections.length) return sections;

    const legacySections = this.answerSectionTitles
      .map((title) => ({ title, body: this.answerSection(item, title), kind: 'text' as const }))
      .filter((section) => section.body);
    return legacySections.length ? legacySections : [{ title: 'Answer', body: item.answer }];
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
