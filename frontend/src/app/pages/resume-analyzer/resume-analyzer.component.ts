import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../shared/services/api.service';
import { ResumeAnalysis, ResumeSuggestion } from '../../shared/models/resume.model';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge/ui-badge.component';
import { ScoreCardComponent } from '../../shared/components/score-card/score-card.component';
import { SkillBadgeComponent } from '../../shared/components/skill-badge/skill-badge.component';
import { SuggestionCardComponent } from '../../shared/components/suggestion-card/suggestion-card.component';

import { ResumeFile, ResumeService } from '../../shared/services/resume.service';

@Component({
  selector: 'app-resume-analyzer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    UiCardComponent,
    UiBadgeComponent,
    ScoreCardComponent,
    SkillBadgeComponent,
    SuggestionCardComponent
  ],
  templateUrl: './resume-analyzer.component.html',
  styleUrl: './resume-analyzer.component.scss'
})
export class ResumeAnalyzerComponent implements OnInit {
  selectedFile: File | null = null;
  isAnalyzing: boolean = false;
  isDownloading: boolean = false;
  isLoadingAnalysis: boolean = false;
  analysisComplete: boolean = false;
  hasNoData: boolean = false;        // true when backend confirmed no resume yet
  resumeFiles: ResumeFile[] = [];
  defaultResumeFileId = '';
  defaultResumeFileName = '';
  activeResumeFileName = '';
  selectedResumeFileId = '';
  viewedResumeFileName = '';
  viewedResumeFileId = '';
  isTemporaryView = false;
  cacheState: 'idle' | 'loading' | 'cache-hit' | 'server-cache-hit' | 're-analysis' | 'error' = 'idle';
  private activeAnalysisRequestKey = '';

  // Resume analysis data
  analysis: ResumeAnalysis | null = null;
  errorMessage: string = '';

  // Snapshot backup used when a new upload/analyze fails
  private previousAnalysis: ResumeAnalysis | null = null;
  private previousAnalysisComplete = false;
  private previousHasNoData = false;

  // Score card data
  scoreCards = [
    { title: 'ATS Compatibility', key: 'atsScore', color: 'purple' as const },
    { title: 'Keyword Density', key: 'keywordDensity', color: 'pink' as const },
    { title: 'Formatting Score', key: 'formatScore', color: 'green' as const },
    { title: 'Content Quality', key: 'contentQuality', color: 'amber' as const }
  ];

  // Skill categories
  skillCategories = [
    'Programming Languages',
    'Frameworks & Libraries',
    'Technologies & Tools',
    'Soft Skills'
  ];

  readonly suggestionPriorityOrder: Record<ResumeSuggestion['color'], number> = {
    red: 0,
    orange: 1,
    purple: 2,
    blue: 3,
    cyan: 4
  };

  constructor(
    private readonly apiService: ApiService,
    private readonly resumeService: ResumeService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadResumeContext();
    this.loadPreviousAnalysis();
  }

  loadResumeContext() {
    this.apiService.getActiveResumeContext().subscribe({
      next: (ctx) => {
        this.defaultResumeFileId = ctx?.defaultResume?.fileId || '';
        this.defaultResumeFileName = ctx?.defaultResume?.fileName || '';
        this.activeResumeFileName = ctx?.defaultResume?.fileName || ctx?.activeResume?.fileName || '';
        if (!this.selectedResumeFileId) {
          this.selectedResumeFileId = this.defaultResumeFileId || ctx?.activeResume?.fileId || '';
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.defaultResumeFileId = '';
        this.defaultResumeFileName = '';
        this.activeResumeFileName = '';
        this.cdr.detectChanges();
      }
    });

    this.apiService.getResumeFiles().subscribe({
      next: (res) => {
        this.resumeFiles = Array.isArray(res?.files) ? res.files : [];
        if (!this.selectedResumeFileId) {
          this.selectedResumeFileId = this.resumeFiles.find((f) => f.isDefault)?.fileId
            || this.resumeFiles.find((f) => f.isActive)?.fileId
            || '';
        }
        this.cdr.detectChanges();
      },
      error: () => {
        this.resumeFiles = [];
        this.cdr.detectChanges();
      }
    });
  }

  useSelectedResume(setAsDefault = false) {
    if (!this.selectedResumeFileId || this.isLoadingAnalysis || this.isAnalyzing) return;

    if (!setAsDefault) {
      const selectedFile = this.getSelectedResumeFile();
      const cached = selectedFile ? this.resumeService.getCachedAnalysis<ResumeAnalysis>(selectedFile) : null;
      if (cached) {
        this.applyAnalysis({
          ...cached,
          cacheMetadata: {
            ...(cached.cacheMetadata || {}),
            loadedFromCache: true,
            cacheHit: true,
            frontendCacheHit: true
          }
        }, 'cache-hit');
        this.syncResumeViewState(cached?.fileId || this.selectedResumeFileId, cached?.fileName || selectedFile?.fileName || '');
        return;
      }

      const requestKey = `preview:${this.selectedResumeFileId}`;
      if (this.activeAnalysisRequestKey === requestKey) return;
      this.activeAnalysisRequestKey = requestKey;
      this.isLoadingAnalysis = true;
      this.cacheState = 'loading';
      this.apiService.getResumeAnalysis(this.selectedResumeFileId).subscribe({
        next: (res) => {
          if (res && res.atsScore != null) {
            this.applyAnalysis(res, res?.cacheMetadata?.loadedFromCache ? 'server-cache-hit' : 'idle');
            this.syncResumeViewState(res?.fileId || this.selectedResumeFileId, res?.fileName || '');
          }
          this.isLoadingAnalysis = false;
          this.activeAnalysisRequestKey = '';
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.errorMessage = err?.error?.message || 'No analysis exists for the selected resume yet.';
          this.isLoadingAnalysis = false;
          this.activeAnalysisRequestKey = '';
          this.cacheState = 'error';
          this.cdr.detectChanges();
        }
      });
      return;
    }

    this.resumeService.setDefaultResume(this.selectedResumeFileId).subscribe({
      next: () => {
        this.isTemporaryView = false;
        this.viewedResumeFileId = this.selectedResumeFileId;
        this.cacheState = 're-analysis';
        this.loadResumeContext();
        this.loadPreviousAnalysis();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to switch resume context.';
        this.cdr.detectChanges();
      }
    });
  }

  /**
   * Load previous analysis on component init
   */
  loadPreviousAnalysis() {
    if (this.isLoadingAnalysis) return;
    this.isLoadingAnalysis = true;
    this.cacheState = 'loading';
    this.apiService.getResumeAnalysis().subscribe({
      next: (res) => {
        if (res && res.atsScore != null) {
          this.applyAnalysis(res, res?.cacheMetadata?.loadedFromCache ? 'server-cache-hit' : 'idle');
          this.syncResumeViewState(res?.fileId || this.defaultResumeFileId, res?.fileName || '');
        } else {
          // API returned but no meaningful data
          this.analysisComplete = false;
          this.hasNoData = true;
        }
        this.isLoadingAnalysis = false;
        this.cdr.detectChanges();
      },
      error: () => {
        // If no local analysis loaded, show empty state.
        // If an analysis already exists in memory, keep showing it.
        if (!this.analysis) {
          this.analysisComplete = false;
          this.hasNoData = true;
        }
        this.isLoadingAnalysis = false;
        this.cacheState = 'error';
        this.cdr.detectChanges();
      }
    });
  }

  onFileSelected(event: any) {
    const file = event.target.files?.[0];
    if (file?.type === 'application/pdf') {
      this.selectedFile = file;
      this.errorMessage = '';
      // Automatically start analysis after file selection
      setTimeout(() => this.analyzeResume(), 100);
    } else {
      this.errorMessage = 'Please select a valid PDF file.';
      setTimeout(() => this.errorMessage = '', 5000);
    }
  }

  analyzeResume() {
    if (!this.selectedFile) return;

    // Save a snapshot so we can restore previous data on failure
    this.previousAnalysis = this.analysis ? JSON.parse(JSON.stringify(this.analysis)) : null;
    this.previousAnalysisComplete = this.analysisComplete;
    this.previousHasNoData = this.hasNoData;

    this.isAnalyzing = true;
    this.errorMessage = '';
    this.cdr.detectChanges();
    
    const formData = new FormData();
    formData.append('file', this.selectedFile);

    this.resumeService.uploadResume(formData).subscribe({
      next: (uploadRes) => {
        // Now analyze the uploaded file
        this.apiService.analyzeResume(uploadRes.fileId).subscribe({
          next: (analysisRes) => {
            this.isAnalyzing = false;
            this.applyAnalysis(analysisRes, analysisRes?.cacheMetadata?.loadedFromCache ? 'server-cache-hit' : 're-analysis');
            this.selectedFile = null;
            this.syncResumeViewState(analysisRes?.fileId || uploadRes.fileId, analysisRes?.fileName || uploadRes.fileName || '');
            this.loadResumeContext();
            this.cdr.detectChanges();
          },
          error: (err) => {
            this.isAnalyzing = false;
            this.errorMessage = err.error?.message || 'Failed to analyze resume. Please try again.';
            // Restore previous successful analysis if available
            this.analysis = this.previousAnalysis;
            this.analysisComplete = this.previousAnalysisComplete;
            this.hasNoData = this.previousHasNoData;
            this.cdr.detectChanges();
            console.error(err);
          }
        });
      },
      error: (err) => {
        this.isAnalyzing = false;
        this.errorMessage = err.error?.message || 'Failed to upload resume. Please ensure you are logged in.';
        // Restore previous successful analysis if available
        this.analysis = this.previousAnalysis;
        this.analysisComplete = this.previousAnalysisComplete;
        this.hasNoData = this.previousHasNoData;
        this.cdr.detectChanges();
        console.error(err);
      }
    });
  }

  /**
   * Get score value from analysis
   */
  getScore(key: string): number {
    if (!this.analysis) return 0;
    return (this.analysis as any)[key] || 0;
  }

  /**
   * Get skills for a category
   */
  getSkillsForCategory(category: string): string[] {
    if (!this.analysis || !this.analysis.skills) return [];
    return this.analysis.skills[category] || [];
  }

  /**
   * Get suggestions — only show real AI-generated suggestions from analysis
   */
  getSuggestions(): ResumeSuggestion[] {
    if (!this.analysis || !this.analysis.suggestions) return [];
    return [...this.analysis.suggestions].sort((left, right) => {
      const leftRank = this.suggestionPriorityOrder[left.color] ?? 99;
      const rightRank = this.suggestionPriorityOrder[right.color] ?? 99;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.title.localeCompare(right.title);
    });
  }

  /**
   * Get total skills count
   */
  getTotalSkillsCount(): number {
    if (!this.analysis || !this.analysis.skills) return 0;
    return Object.values(this.analysis.skills).reduce((sum, skills) => sum + (skills?.length || 0), 0);
  }

  getDetectedSkillGroups(): Array<{ category: string; skills: string[] }> {
    return this.skillCategories.map((category) => ({
      category,
      skills: this.getSkillsForCategory(category)
    }));
  }

  getTechnologyGroups(): Array<{ category: string; skills: string[] }> {
    const categories = this.analysis?.technologyCategories || {};
    return Object.keys(categories)
      .map((category) => ({ category, skills: categories[category] || [] }))
      .filter((group) => group.skills.length > 0);
  }

  getQualityScoreEntries(): Array<{ label: string; value: number; explanation: string }> {
    const scores = this.analysis?.qualityScores || {};
    const explanations = scores['explanations'] || {};
    const labels: Record<string, string> = {
      overallResumeScore: 'Overall Resume Score',
      atsScore: 'ATS Score',
      keywordCoverage: 'Keyword Coverage',
      formattingScore: 'Formatting Score',
      contentQuality: 'Content Quality',
      projectQuality: 'Project Quality',
      experienceStrength: 'Experience Strength',
      skillsCoverage: 'Skills Coverage',
      technicalDepth: 'Technical Depth',
      recruiterReadiness: 'Recruiter Readiness'
    };

    return Object.keys(labels)
      .filter((key) => scores[key] !== undefined)
      .map((key) => ({
        label: labels[key],
        value: Number(scores[key] || 0),
        explanation: String(explanations[key] || '')
      }));
  }

  getWarnings(): Array<{ code: string; severity: string; message: string; evidence?: string }> {
    return this.analysis?.consistencyWarnings || [];
  }

  getPersonalInfoEntries(): Array<{ label: string; value: string }> {
    const info = this.analysis?.normalized?.personalInfo || {};
    const labels: Record<string, string> = {
      name: 'Name',
      email: 'Email',
      phone: 'Phone',
      location: 'Location',
      portfolio: 'Portfolio',
      linkedIn: 'LinkedIn',
      github: 'GitHub'
    };
    return Object.keys(labels).map((key) => ({
      label: labels[key],
      value: String(info[key] || 'Missing')
    }));
  }

  getNormalizedList(key: keyof NonNullable<ResumeAnalysis['normalized']>): string[] {
    const value = this.analysis?.normalized?.[key];
    return Array.isArray(value) ? value : [];
  }

  getRecruiterList(key: 'strengths' | 'concerns' | 'interviewRisks'): string[] {
    const value = this.analysis?.recruiterPerspective?.[key];
    return Array.isArray(value) ? value : [];
  }

  getScoreChangeEntries(): Array<{ label: string; value: number }> {
    const changes = this.analysis?.scoreChanges || this.analysis?.improvementDelta?.['scoreChanges'] || {};
    const labels: Record<string, string> = {
      atsScore: 'ATS',
      keywordDensity: 'Keywords',
      formatScore: 'Formatting',
      contentQuality: 'Content',
      overallResumeScore: 'Overall'
    };
    return Object.keys(labels)
      .filter((key) => changes[key] !== undefined)
      .map((key) => ({ label: labels[key], value: Number(changes[key] || 0) }));
  }

  getTopSuggestionLabel(index: number): string {
    if (index === 0) return 'Highest priority';
    if (index === 1) return 'Next focus';
    if (index === 2) return 'Worth improving';
    return `Step ${index + 1}`;
  }

  /**
   * Format file size
   */
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (Math.round(bytes / Math.pow(k, i) * 100) / 100) + ' ' + sizes[i];
  }

  /**
   * Format date relative to now
   */
  formatDate(dateString: string): string {
    if (!dateString) return 'not available';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    return `${diffDays} day${diffDays > 1 ? 's' : ''} ago`;
  }

  forceRefreshSelected(): void {
    if (!this.selectedResumeFileId || this.isAnalyzing || this.isLoadingAnalysis) return;
    const requestKey = `force:${this.selectedResumeFileId}`;
    if (this.activeAnalysisRequestKey === requestKey) return;
    this.activeAnalysisRequestKey = requestKey;
    this.isLoadingAnalysis = true;
    this.cacheState = 're-analysis';
    this.apiService.analyzeResume(this.selectedResumeFileId, true).subscribe({
      next: (res) => {
        this.applyAnalysis(res, 're-analysis');
        this.syncResumeViewState(res?.fileId || this.selectedResumeFileId, res?.fileName || '');
        this.loadResumeContext();
        this.isLoadingAnalysis = false;
        this.activeAnalysisRequestKey = '';
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.errorMessage = err?.error?.message || 'Failed to refresh resume analysis.';
        this.isLoadingAnalysis = false;
        this.activeAnalysisRequestKey = '';
        this.cacheState = 'error';
        this.cdr.detectChanges();
      }
    });
  }

  downloadGuide() {
    if (!this.analysisComplete || this.isDownloading) return;

    this.isDownloading = true;
    this.errorMessage = '';
    this.cdr.detectChanges();

    this.apiService.downloadResumeGuide().subscribe({
      next: (blob: Blob) => {
        const url  = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href  = url;
        link.download = `resume-guide.html`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        this.isDownloading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isDownloading = false;
        this.errorMessage = err.error?.message || 'Failed to generate resume guide. Please try again.';
        this.cdr.detectChanges();
        setTimeout(() => { this.errorMessage = ''; this.cdr.detectChanges(); }, 6000);
      }
    });
  }

  returnToDefaultResume(): void {
    if (!this.defaultResumeFileId || this.isAnalyzing) return;
    this.selectedResumeFileId = this.defaultResumeFileId;
    this.loadPreviousAnalysis();
  }

  private syncResumeViewState(fileId: string, fileName: string): void {
    this.viewedResumeFileId = String(fileId || '').trim();
    this.viewedResumeFileName = String(fileName || '').trim();
    this.isTemporaryView = Boolean(this.defaultResumeFileId && this.viewedResumeFileId && this.viewedResumeFileId !== this.defaultResumeFileId);
  }

  private getSelectedResumeFile(): ResumeFile | undefined {
    return this.resumeFiles.find((file) => file.fileId === this.selectedResumeFileId);
  }

  private applyAnalysis(res: ResumeAnalysis, cacheState: typeof this.cacheState): void {
    this.analysis = res;
    this.analysisComplete = true;
    this.hasNoData = false;
    this.errorMessage = '';
    this.cacheState = cacheState;
    this.resumeService.cacheAnalysis({
      fileId: res.fileId || this.selectedResumeFileId,
      resumeHash: res.resumeHash || res.cacheMetadata?.resumeHash || '',
      analysisVersion: res.analysisVersion || res.cacheMetadata?.analysisVersion || 'resume-intel-v2'
    }, res);
  }
}
