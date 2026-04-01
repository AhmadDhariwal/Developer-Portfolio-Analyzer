import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
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
export class InterviewPrepComponent implements OnInit, OnDestroy {
  readonly pageSize = 10;
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
    'mern',
    'mean',
    'full-stack-web-development'
  ];
  readonly tabs: Array<{ id: InterviewTab; label: string }> = [
    { id: 'top', label: 'Top Questions' },
    { id: 'search', label: 'Search Questions' },
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
    mern: 'MERN',
    mean: 'MEAN',
    'full-stack-web-development': 'Full Stack Web Development'
  };

  activeTab: InterviewTab = 'top';
  selectedSkill = 'javascript';
  selectedDifficulty = '';
  tagsInput = '';
  searchQuery = '';
  aiPromptQuery = '';

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

  private readonly subscriptions = new Subscription();
  private readonly searchChanges = new Subject<string>();

  constructor(
    private readonly prepService: InterviewPrepService,
    private readonly careerProfileService: CareerProfileService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit(): void {
    this.selectedSkill = this.mapCareerProfileToSkill(this.careerProfileService.snapshot.careerStack);
    this.subscriptions.add(
      this.searchChanges.pipe(debounceTime(300), distinctUntilChanged()).subscribe((query) => {
        if (this.activeTab !== 'search') return;
        this.searchQuery = query;
        if (query.trim().length < 2) {
          this.questions = [];
          this.total = 0;
          this.currentPage = 1;
          this.totalPages = 1;
          this.errorMessage = '';
          this.cdr.markForCheck();
          return;
        }
        this.fetchSearchQuestions(true);
      })
    );

    this.fetchTopQuestions(true);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  get canLoadMore(): boolean {
    if (this.isLoadingMore || this.isLoading) return false;
    if (this.activeTab !== 'top' && this.activeTab !== 'search') return false;
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
      if (this.searchQuery.trim().length >= 2) {
        this.fetchSearchQuestions(true);
      } else {
        this.questions = [];
        this.total = 0;
        this.currentPage = 1;
        this.totalPages = 1;
      }
    } else {
      this.questions = [];
      this.total = 0;
      this.currentPage = 1;
      this.totalPages = 1;
    }

    this.cdr.markForCheck();
  }

  onSearchQueryChange(value: string): void {
    this.searchChanges.next(value);
  }

  onSkillChange(): void {
    this.openAnswers.clear();
    if (this.activeTab === 'top') {
      this.fetchTopQuestions(true);
      return;
    }
    if (this.activeTab === 'search' && this.searchQuery.trim().length >= 2) {
      this.fetchSearchQuestions(true);
    }
  }

  applyFilters(): void {
    this.openAnswers.clear();
    if (this.activeTab === 'top') {
      this.fetchTopQuestions(true);
      return;
    }
    if (this.activeTab === 'search' && this.searchQuery.trim().length >= 2) {
      this.fetchSearchQuestions(true);
    }
  }

  clearFilters(): void {
    this.selectedDifficulty = '';
    this.tagsInput = '';
    this.applyFilters();
  }

  loadMore(): void {
    if (!this.canLoadMore) return;
    if (this.activeTab === 'top') {
      this.fetchTopQuestions(false);
      return;
    }
    if (this.activeTab === 'search') {
      this.fetchSearchQuestions(false);
    }
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
      page: 1,
      limit: this.pageSize
    }).subscribe({
      next: (response) => {
        this.consumeResponse(response, true);
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

  fetchTopQuestions(reset: boolean): void {
    const page = reset ? 1 : this.currentPage + 1;
    this.isLoading = reset;
    this.isLoadingMore = !reset;
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.prepService.getTopQuestions({
      skill: this.selectedSkill,
      page,
      limit: this.pageSize,
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

  fetchSearchQuestions(reset: boolean): void {
    const query = this.searchQuery.trim();
    if (query.length < 2) return;

    const page = reset ? 1 : this.currentPage + 1;
    this.isLoading = reset;
    this.isLoadingMore = !reset;
    this.errorMessage = '';
    this.cdr.markForCheck();

    this.prepService.searchQuestions({
      q: query,
      skill: this.selectedSkill,
      difficulty: this.selectedDifficulty || undefined,
      tags: this.parseTags(),
      page,
      limit: this.pageSize
    }).subscribe({
      next: (response) => {
        this.consumeResponse(response, reset);
      },
      error: (error) => {
        this.errorMessage = error?.error?.message || 'Search failed.';
        this.isLoading = false;
        this.isLoadingMore = false;
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

  getHighlightedText(text: string): string {
    const safeText = this.escapeHtml(text);
    const keyword = this.searchQuery.trim();
    if (!keyword || this.activeTab !== 'search') return safeText;
    const pattern = new RegExp(`(${this.escapeRegExp(keyword)})`, 'ig');
    return safeText.replace(pattern, '<mark>$1</mark>');
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

  trackByQuestion(_index: number, item: InterviewQuestion): string {
    return item._id || item.question;
  }

  getSkillLabel(skill: string): string {
    return this.skillLabels[skill] || skill;
  }
}
