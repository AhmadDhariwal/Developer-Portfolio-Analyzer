import { Component, OnDestroy, OnInit, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../shared/services/api.service';
import { ResumeAnalysis, ResumeSuggestion } from '../../shared/models/resume.model';
import { UiCardComponent } from '../../shared/components/ui-card/ui-card.component';
import { UiBadgeComponent } from '../../shared/components/ui-badge/ui-badge.component';
import { SkillBadgeComponent } from '../../shared/components/skill-badge/skill-badge.component';
import { SuggestionCardComponent } from '../../shared/components/suggestion-card/suggestion-card.component';
import { Subscription } from 'rxjs';

import { ResumeFile, ResumeService } from '../../shared/services/resume.service';

type ScoreTone = 'purple' | 'pink' | 'green' | 'amber';
type WarningSeverity = 'high' | 'medium' | 'low' | 'info';

interface ScoreViewModel {
  key: string;
  label: string;
  value: number;
  explanation: string;
  tone: ScoreTone;
}

interface SkillGroupViewModel {
  category: string;
  skills: string[];
}

interface WarningGroupViewModel {
  severity: WarningSeverity;
  label: string;
  warnings: Array<{ code: string; message: string; evidence?: string }>;
}

interface TextSectionViewModel {
  key: string;
  title: string;
  items: string[];
}

interface ScoreChangeViewModel {
  key: string;
  label: string;
  previous: number;
  current: number;
  delta: number;
}

@Component({
  selector: 'app-resume-analyzer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    UiCardComponent,
    UiBadgeComponent,
    SkillBadgeComponent,
    SuggestionCardComponent
  ],
  templateUrl: './resume-analyzer.component.html',
  styleUrl: './resume-analyzer.component.scss'
})
export class ResumeAnalyzerComponent implements OnInit, OnDestroy {
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
  private readonly subscriptions = new Subscription();
  private bootstrapAnalysisResolved = false;

  // Resume analysis data
  analysis: ResumeAnalysis | null = null;
  errorMessage: string = '';

  scoreCardViewModels: ScoreViewModel[] = [];
  atsBreakdownViewModels: ScoreViewModel[] = [];
  skillGroupViewModels: SkillGroupViewModel[] = [];
  warningGroupViewModels: WarningGroupViewModel[] = [];
  recruiterSectionViewModels: TextSectionViewModel[] = [];
  intelligenceSectionViewModels: TextSectionViewModel[] = [];
  personalInfoViewModels: Array<{ label: string; value: string }> = [];
  suggestionViewModels: ResumeSuggestion[] = [];
  growthScoreViewModels: ScoreChangeViewModel[] = [];
  growthNewSkills: string[] = [];
  growthSummary = '';
  overviewSummary = '';
  hiringReadiness = '';
  detectedSkillCount = 0;

  // Snapshot backup used when a new upload/analyze fails
  private previousAnalysis: ResumeAnalysis | null = null;
  private previousAnalysisComplete = false;
  private previousHasNoData = false;

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
    this.subscriptions.add(
      this.resumeService.profile$.subscribe((profile) => {
        this.syncResumeContext(profile?.defaultResume?.fileId || '', profile?.defaultResume?.fileName || '', profile?.activeResume?.fileName || '');
      })
    );

    this.subscriptions.add(
      this.resumeService.resumes$.subscribe((files) => {
        this.resumeFiles = Array.isArray(files) ? files : [];
        this.syncResumeContext(this.defaultResumeFileId, this.defaultResumeFileName, this.activeResumeFileName);
      })
    );

    this.subscriptions.add(
      this.resumeService.loading$.subscribe((loading) => {
        if (!loading && !this.bootstrapAnalysisResolved) {
          this.loadPreviousAnalysis();
        }
      })
    );

    if (!this.resumeService.loadingSubjectValue() && !this.resumeFiles.length && !this.resumeService.profileSubjectValue()) {
      this.resumeService.refresh();
    }
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
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
          if (res && res.atsScore != null && this.matchesAnalysisFile(res, this.selectedResumeFileId)) {
            this.applyAnalysis(res, res?.cacheMetadata?.loadedFromCache ? 'server-cache-hit' : 'idle');
            this.syncResumeViewState(res?.fileId || this.selectedResumeFileId, res?.fileName || '');
          } else {
            this.errorMessage = 'The selected resume does not have an analysis yet.';
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
        if (this.analysis?.fileId === this.selectedResumeFileId) {
          this.defaultResumeFileId = this.selectedResumeFileId;
          this.defaultResumeFileName = this.analysis?.fileName || this.defaultResumeFileName;
          this.syncResumeViewState(this.selectedResumeFileId, this.analysis?.fileName || this.viewedResumeFileName);
        }
        this.cdr.detectChanges();
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
    const expectedFile = this.getDefaultOrSelectedResumeFile();
    const expectedFileId = String(expectedFile?.fileId || this.selectedResumeFileId || this.defaultResumeFileId || '').trim();
    const current = this.resumeService.getCurrentAnalysis<ResumeAnalysis>();
    if (current && this.matchesAnalysisFile(current, expectedFileId)) {
      this.applyAnalysis({
        ...current,
        cacheMetadata: {
          ...(current.cacheMetadata || {}),
          loadedFromCache: true,
          cacheHit: true,
          frontendCacheHit: true
        }
      }, 'cache-hit');
      this.syncResumeViewState(current?.fileId || expectedFileId, current?.fileName || expectedFile?.fileName || '');
      this.bootstrapAnalysisResolved = true;
      this.isLoadingAnalysis = false;
      this.cdr.detectChanges();
      return;
    }

    const cached = expectedFile ? this.resumeService.getCachedAnalysis<ResumeAnalysis>(expectedFile) : null;
    if (cached && this.matchesAnalysisFile(cached, expectedFileId)) {
      this.applyAnalysis({
        ...cached,
        cacheMetadata: {
          ...(cached.cacheMetadata || {}),
          loadedFromCache: true,
          cacheHit: true,
          frontendCacheHit: true
        }
      }, 'cache-hit');
      this.syncResumeViewState(cached?.fileId || expectedFileId, cached?.fileName || expectedFile?.fileName || '');
      this.bootstrapAnalysisResolved = true;
      this.isLoadingAnalysis = false;
      this.cdr.detectChanges();
      return;
    }

    this.isLoadingAnalysis = true;
    this.cacheState = 'loading';
    this.apiService.getResumeAnalysis().subscribe({
      next: (res) => {
        if (res && res.atsScore != null && this.matchesAnalysisFile(res, expectedFileId)) {
          this.applyAnalysis(res, res?.cacheMetadata?.loadedFromCache ? 'server-cache-hit' : 'idle');
          this.syncResumeViewState(res?.fileId || this.defaultResumeFileId, res?.fileName || '');
        } else {
          this.analysisComplete = false;
          this.hasNoData = true;
          this.resumeService.setCurrentAnalysis(null);
          if (expectedFileId) this.errorMessage = 'The selected default resume does not have an analysis yet.';
        }
        this.bootstrapAnalysisResolved = true;
        this.isLoadingAnalysis = false;
        this.cdr.detectChanges();
      },
      error: () => {
        // If no local analysis loaded, show empty state.
        // If an analysis already exists in memory, keep showing it.
        if (!this.analysis) {
          this.analysisComplete = false;
          this.hasNoData = true;
          this.resumeService.setCurrentAnalysis(null);
        }
        this.bootstrapAnalysisResolved = true;
        this.isLoadingAnalysis = false;
        this.cacheState = 'error';
        this.cdr.detectChanges();
      }
    });
  }

  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file?.type === 'application/pdf') {
      if (this.isAnalyzing) return;
      this.selectedFile = file;
      this.errorMessage = '';
      this.analyzeResume();
    } else {
      this.errorMessage = 'Please select a valid PDF file.';
      setTimeout(() => this.errorMessage = '', 5000);
    }
    input.value = '';
  }

  analyzeResume() {
    if (!this.selectedFile || this.isAnalyzing) return;
    const selectedFile = this.selectedFile;
    const requestKey = `upload:${selectedFile.name}:${selectedFile.size}:${selectedFile.lastModified}`;
    if (this.activeAnalysisRequestKey === requestKey) return;
    this.activeAnalysisRequestKey = requestKey;

    // Save a snapshot so we can restore previous data on failure
    this.previousAnalysis = this.analysis ? JSON.parse(JSON.stringify(this.analysis)) : null;
    this.previousAnalysisComplete = this.analysisComplete;
    this.previousHasNoData = this.hasNoData;

    this.isAnalyzing = true;
    this.errorMessage = '';
    this.cdr.detectChanges();
    
    const formData = new FormData();
    formData.append('file', selectedFile);

    this.resumeService.uploadResume(formData).subscribe({
      next: (uploadRes) => {
        // Now analyze the uploaded file
        this.apiService.analyzeResume(uploadRes.fileId).subscribe({
          next: (analysisRes) => {
            this.isAnalyzing = false;
            this.activeAnalysisRequestKey = '';
            this.applyAnalysis(analysisRes, analysisRes?.cacheMetadata?.loadedFromCache ? 'server-cache-hit' : 're-analysis');
            this.selectedFile = null;
            this.syncResumeViewState(analysisRes?.fileId || uploadRes.fileId, analysisRes?.fileName || uploadRes.fileName || '');
            this.cdr.detectChanges();
          },
          error: (err) => {
            this.isAnalyzing = false;
            this.activeAnalysisRequestKey = '';
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
        this.activeAnalysisRequestKey = '';
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

  private rebuildViewModels(analysis: ResumeAnalysis): void {
    const qualityScores = analysis.qualityScores || {};
    const explanations = (qualityScores['explanations'] || {}) as Record<string, unknown>;
    const scoreBreakdown = (analysis as ResumeAnalysis & { scoreBreakdown?: Record<string, string> }).scoreBreakdown || {};

    const makeScore = (
      key: string,
      label: string,
      value: unknown,
      explanation: unknown,
      tone: ScoreTone
    ): ScoreViewModel | null => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return null;
      return {
        key,
        label,
        value: Math.max(0, Math.min(100, Math.round(parsed))),
        explanation: String(explanation || '').trim(),
        tone
      };
    };

    this.scoreCardViewModels = [
      makeScore('overallResumeScore', 'Overall Resume Score', qualityScores['overallResumeScore'], explanations['overallResumeScore'], 'purple'),
      makeScore('atsScore', 'ATS Compatibility', analysis.atsScore, scoreBreakdown['atsScore'] || explanations['atsScore'], 'pink'),
      makeScore('recruiterReadiness', 'Recruiter Readiness', qualityScores['recruiterReadiness'], explanations['recruiterReadiness'], 'green'),
      makeScore('contentQuality', 'Content Quality', analysis.contentQuality, scoreBreakdown['contentQuality'] || explanations['contentQuality'], 'amber')
    ].filter((item): item is ScoreViewModel => Boolean(item));

    this.atsBreakdownViewModels = [
      makeScore('keywordCoverage', 'Keyword Coverage', qualityScores['keywordCoverage'] ?? analysis.keywordDensity, explanations['keywordCoverage'] || scoreBreakdown['keywordDensity'], 'pink'),
      makeScore('formattingScore', 'ATS Formatting', qualityScores['formattingScore'] ?? analysis.formatScore, explanations['formattingScore'] || scoreBreakdown['formatScore'], 'green'),
      makeScore('projectQuality', 'Project Evidence', qualityScores['projectQuality'], explanations['projectQuality'], 'purple'),
      makeScore('experienceStrength', 'Experience Strength', qualityScores['experienceStrength'], explanations['experienceStrength'], 'amber'),
      makeScore('skillsCoverage', 'Skills Coverage', qualityScores['skillsCoverage'], explanations['skillsCoverage'], 'green'),
      makeScore('technicalDepth', 'Technical Depth', qualityScores['technicalDepth'], explanations['technicalDepth'], 'purple')
    ].filter((item): item is ScoreViewModel => Boolean(item));

    const technologyGroups = this.toSkillGroups(analysis.technologyCategories);
    this.skillGroupViewModels = technologyGroups.length ? technologyGroups : this.toSkillGroups(analysis.skills);
    this.detectedSkillCount = new Set(
      this.skillGroupViewModels.flatMap((group) => group.skills.map((skill) => skill.toLowerCase()))
    ).size;

    this.personalInfoViewModels = this.toLabelValueEntries(analysis.normalized?.personalInfo || {}, {
      name: 'Candidate Name',
      email: 'Email',
      phone: 'Phone',
      location: 'Location',
      portfolio: 'Portfolio',
      linkedIn: 'LinkedIn',
      github: 'GitHub'
    });

    this.overviewSummary = String(analysis.recruiterPerspective?.resumeSummary || '').trim();
    this.hiringReadiness = String(analysis.recruiterPerspective?.hiringReadiness || '').trim();
    this.recruiterSectionViewModels = [
      this.makeTextSection('strengths', 'Recruiter-Visible Strengths', analysis.recruiterPerspective?.strengths),
      this.makeTextSection('concerns', 'Recruiter Concerns', analysis.recruiterPerspective?.concerns),
      this.makeTextSection('interviewRisks', 'Interview Validation Areas', analysis.recruiterPerspective?.interviewRisks)
    ].filter((section): section is TextSectionViewModel => Boolean(section));

    this.warningGroupViewModels = this.buildWarningGroups(analysis);
    this.intelligenceSectionViewModels = [
      this.makeTextSection('experience', 'Experience Evidence', analysis.normalized?.experience),
      this.makeTextSection('projects', 'Project Evidence', analysis.normalized?.projects),
      this.makeTextSection('achievements', 'Measured Achievements', analysis.normalized?.achievements),
      this.makeTextSection('certifications', 'Certifications', analysis.normalized?.certifications),
      this.makeTextSection('education', 'Education', analysis.normalized?.education),
      this.makeTextSection('openSourceContributions', 'Open Source Contributions', analysis.normalized?.openSourceContributions),
      this.makeTextSection('leadership', 'Leadership Evidence', analysis.normalized?.leadership),
      this.makeTextSection('publications', 'Publications', analysis.normalized?.publications),
      this.makeTextSection('volunteerWork', 'Volunteer Experience', analysis.normalized?.volunteerWork)
    ].filter((section): section is TextSectionViewModel => Boolean(section));

    this.suggestionViewModels = (Array.isArray(analysis.suggestions) ? analysis.suggestions : [])
      .filter((suggestion) => Boolean(suggestion?.title?.trim() && suggestion?.description?.trim()))
      .sort((left, right) => {
        const leftRank = this.suggestionPriorityOrder[left.color] ?? 99;
        const rightRank = this.suggestionPriorityOrder[right.color] ?? 99;
        if (leftRank !== rightRank) return leftRank - rightRank;
        return left.title.localeCompare(right.title);
      });

    const changes = analysis.scoreChanges || analysis.improvementDelta?.['scoreChanges'] || {};
    const currentScores: Record<string, unknown> = {
      atsScore: analysis.atsScore,
      keywordDensity: analysis.keywordDensity,
      formatScore: analysis.formatScore,
      contentQuality: analysis.contentQuality,
      overallResumeScore: qualityScores['overallResumeScore']
    };
    const changeLabels: Record<string, string> = {
      atsScore: 'ATS Compatibility',
      keywordDensity: 'Keyword Coverage',
      formatScore: 'ATS Formatting',
      contentQuality: 'Content Quality',
      overallResumeScore: 'Overall Resume Score'
    };
    const hasPrevious = analysis.improvementDelta?.['hasPrevious'] === true || Boolean(analysis.previousAnalysisId);
    this.growthScoreViewModels = hasPrevious
      ? Object.keys(changeLabels).flatMap((key) => {
        const delta = Number(changes[key]);
        const current = Number(currentScores[key]);
        if (!Number.isFinite(delta) || !Number.isFinite(current)) return [];
        return [{ key, label: changeLabels[key], previous: Math.round(current - delta), current: Math.round(current), delta: Math.round(delta) }];
      })
      : [];
    this.growthNewSkills = hasPrevious ? this.cleanStrings(analysis.newSkillsAdded) : [];
    this.growthSummary = hasPrevious ? String(analysis.improvementDelta?.['summary'] || '').trim() : '';
  }

  private toSkillGroups(value: Record<string, string[]> | undefined): SkillGroupViewModel[] {
    return Object.entries(value || {})
      .map(([category, skills]) => ({ category: category.trim(), skills: this.cleanStrings(skills) }))
      .filter((group) => Boolean(group.category && group.skills.length));
  }

  private toLabelValueEntries(value: Record<string, string>, labels: Record<string, string>): Array<{ label: string; value: string }> {
    return Object.entries(labels)
      .map(([key, label]) => ({ label, value: String(value[key] || '').trim() }))
      .filter((entry) => Boolean(entry.value));
  }

  private makeTextSection(key: string, title: string, values: unknown): TextSectionViewModel | null {
    const items = this.cleanStrings(values);
    return items.length ? { key, title, items } : null;
  }

  private cleanStrings(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
  }

  private buildWarningGroups(analysis: ResumeAnalysis): WarningGroupViewModel[] {
    const order: WarningSeverity[] = ['high', 'medium', 'low', 'info'];
    const labels: Record<WarningSeverity, string> = {
      high: 'High Priority',
      medium: 'Medium Priority',
      low: 'Low Priority',
      info: 'Review Notes'
    };
    const grouped = new Map<WarningSeverity, WarningGroupViewModel['warnings']>();
    (analysis.consistencyWarnings || []).forEach((warning) => {
      const message = String(warning?.message || '').trim();
      if (!message) return;
      const rawSeverity = String(warning?.severity || '').toLowerCase();
      const severity: WarningSeverity = order.includes(rawSeverity as WarningSeverity)
        ? rawSeverity as WarningSeverity
        : 'info';
      const warnings = grouped.get(severity) || [];
      warnings.push({
        code: String(warning?.code || '').trim(),
        message,
        evidence: String(warning?.evidence || '').trim() || undefined
      });
      grouped.set(severity, warnings);
    });
    return order
      .filter((severity) => grouped.has(severity))
      .map((severity) => ({ severity, label: labels[severity], warnings: grouped.get(severity) || [] }));
  }

  /**
   * Get suggestions — only show real AI-generated suggestions from analysis
   */
  getTopSuggestionLabel(index: number): string {
    if (index === 0) return 'Highest priority';
    if (index === 1) return 'Next focus';
    if (index === 2) return 'Worth improving';
    return `Step ${index + 1}`;
  }

  get hasOverviewContent(): boolean {
    return Boolean(this.overviewSummary || this.hiringReadiness || this.personalInfoViewModels.length);
  }

  get hasGrowthData(): boolean {
    return Boolean(this.growthSummary || this.growthNewSkills.length || this.growthScoreViewModels.length);
  }

  get cacheStatusLabel(): string {
    if (this.cacheState === 'cache-hit') return 'Frontend cache';
    if (this.cacheState === 'server-cache-hit') return 'Backend cache';
    if (this.cacheState === 're-analysis') return 'Fresh analysis';
    return '';
  }

  /**
   * Format file size
   */
  formatFileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return (Math.round(bytes / Math.pow(k, i) * 100) / 100) + ' ' + sizes[i];
  }

  /**
   * Format date relative to now
   */
  formatDate(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return '';
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
        this.resumeService.refresh();
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

  private syncResumeContext(defaultFileId: string, defaultFileName: string, activeFileName: string): void {
    this.defaultResumeFileId = String(defaultFileId || this.resumeFiles.find((file) => file.isDefault)?.fileId || '').trim();
    this.defaultResumeFileName = String(defaultFileName || this.resumeFiles.find((file) => file.fileId === this.defaultResumeFileId)?.fileName || '').trim();
    this.activeResumeFileName = String(
      defaultFileName
      || activeFileName
      || this.resumeFiles.find((file) => file.fileId === this.defaultResumeFileId)?.fileName
      || this.resumeFiles.find((file) => file.isActive)?.fileName
      || ''
    ).trim();

    if (!this.selectedResumeFileId) {
      this.selectedResumeFileId = this.defaultResumeFileId
        || this.resumeFiles.find((file) => file.isDefault)?.fileId
        || this.resumeFiles.find((file) => file.isActive)?.fileId
        || '';
    }

    this.cdr.detectChanges();
  }

  private getSelectedResumeFile(): ResumeFile | undefined {
    return this.resumeFiles.find((file) => file.fileId === this.selectedResumeFileId);
  }

  private getDefaultOrSelectedResumeFile(): ResumeFile | undefined {
    return this.getSelectedResumeFile()
      || this.resumeFiles.find((file) => file.fileId === this.defaultResumeFileId)
      || this.resumeFiles.find((file) => file.isDefault)
      || this.resumeFiles.find((file) => file.isActive);
  }

  private matchesAnalysisFile(res: ResumeAnalysis | null | undefined, expectedFileId: string): boolean {
    const resolvedExpected = String(expectedFileId || '').trim();
    if (!resolvedExpected) return Boolean(res);
    return String(res?.fileId || '').trim() === resolvedExpected;
  }

  private applyAnalysis(res: ResumeAnalysis, cacheState: typeof this.cacheState): void {
    this.analysis = res;
    this.analysisComplete = true;
    this.hasNoData = false;
    this.errorMessage = '';
    this.cacheState = cacheState;
    this.rebuildViewModels(res);
    this.resumeFiles = this.resumeFiles.map((file) => (
      file.fileId === (res.fileId || this.selectedResumeFileId)
        ? {
          ...file,
          isAnalyzed: true,
          resumeHash: res.resumeHash || res.cacheMetadata?.resumeHash || file.resumeHash,
          analysisVersion: res.analysisVersion || res.cacheMetadata?.analysisVersion || file.analysisVersion,
          lastAnalyzed: res.analyzedAt || file.lastAnalyzed
        }
        : file
    ));
    this.resumeService.setCurrentAnalysis(res);
    this.resumeService.cacheAnalysis({
      fileId: res.fileId || this.selectedResumeFileId,
      resumeHash: res.resumeHash || res.cacheMetadata?.resumeHash || '',
      analysisVersion: res.analysisVersion || res.cacheMetadata?.analysisVersion || 'resume-intel-v2'
    }, res);
  }
}
