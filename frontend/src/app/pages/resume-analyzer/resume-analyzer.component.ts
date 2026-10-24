import {
  Component,
  OnInit,
  ChangeDetectorRef,
  inject,
  DestroyRef
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, of } from 'rxjs';
import { catchError, exhaustMap, filter, switchMap, tap } from 'rxjs/operators';

import { ApiService } from '../../shared/services/api.service';
import {
  ResumeAnalysis,
  ResumeFile,
  ResumeSuggestion,
  ResumeWarning,
  ContentQualityStatus,
  ResumeContentQualityState,
  ResumeScoringBreakdownItem
} from '../../shared/models/resume.model';
import { ResumeService } from '../../shared/services/resume.service';
import {
  UiButtonComponent,
  UiCardComponent,
  UiMetricCardComponent,
  ScoreCardComponent,
  ScoreCardColor,
  UiBadgeComponent,
  BadgeVariant,
  UiSkeletonComponent,
  UiEmptyStateComponent,
  UiProgressComponent,
  ProgressColor,
  UiPageHeaderComponent,
  UiSectionHeaderComponent
} from '../../shared/components';
import { SkillBadgeComponent } from '../../shared/components/skill-badge/skill-badge.component';

export interface DisplayBreakdownDimension {
  key: string;
  label: string;
  description: string;
  weightPct: number;
  value: number | null;
  contribution: number | null;
  available: boolean;
  explanation: string;
  tone: ProgressColor;
}

export interface SkillGroupViewModel {
  category: string;
  skills: string[];
}

export interface SectionPresenceItem {
  key: string;
  label: string;
  present: boolean;
}

export interface QualityIndicatorConfig {
  label: string;
  badgeVariant: BadgeVariant;
  title: string;
  description: string;
  recoveryCta: string | null;
}

const DIMENSION_METADATA: Record<string, { label: string; description: string; weight: number; tone: ProgressColor }> = {
  atsScore: {
    label: 'ATS Compatibility',
    description: 'Header parsability, standard section recognition, and contact formatting.',
    weight: 18,
    tone: 'primary'
  },
  contentQuality: {
    label: 'Content Quality',
    description: 'Density of action verbs, clear role responsibilities, and professional tone.',
    weight: 16,
    tone: 'info'
  },
  keywordDensity: {
    label: 'Keyword Density',
    description: 'Relevance and distribution of industry-standard technology terms.',
    weight: 12,
    tone: 'primary'
  },
  formatScore: {
    label: 'Formatting & Layout',
    description: 'Consistent bullet structures, readable chronology, and clean margins.',
    weight: 12,
    tone: 'success'
  },
  projectQuality: {
    label: 'Project Evidence',
    description: 'Demonstrated outcomes, architecture details, and technical ownership in projects.',
    weight: 12,
    tone: 'secondary'
  },
  experienceStrength: {
    label: 'Experience Impact',
    description: 'Quantified results, tenure depth, and verifiable business contributions.',
    weight: 12,
    tone: 'warning'
  },
  skillsCoverage: {
    label: 'Skills Breadth',
    description: 'Coverage across languages, frameworks, cloud tools, and databases.',
    weight: 10,
    tone: 'success'
  },
  technicalDepth: {
    label: 'Technical Depth',
    description: 'Sophistication of tooling, distributed patterns, and automated pipelines.',
    weight: 8,
    tone: 'info'
  }
};

@Component({
  selector: 'app-resume-analyzer',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    UiButtonComponent,
    UiCardComponent,
    UiMetricCardComponent,
    ScoreCardComponent,
    UiBadgeComponent,
    UiProgressComponent,
    UiSkeletonComponent,
    UiEmptyStateComponent,
    UiPageHeaderComponent,
    UiSectionHeaderComponent,
    SkillBadgeComponent
  ],
  templateUrl: './resume-analyzer.component.html',
  styleUrl: './resume-analyzer.component.scss'
})
export class ResumeAnalyzerComponent implements OnInit {
  private readonly apiService = inject(ApiService);
  private readonly resumeService = inject(ResumeService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);

  // Resume library & selection
  resumeFiles: ResumeFile[] = [];
  selectedResumeFileId = '';
  activeResumeFileId = '';
  defaultResumeFileId = '';
  activeResumeFileName = '';
  viewedResumeFileName = '';
  viewedResumeFileId = '';

  // Core state flags
  isLoadingAnalysis = false;
  isAnalyzing = false;
  isUploading = false;
  isDownloading = false;
  analysisComplete = false;
  hasNoData = false;
  isUnanalyzedSelected = false;
  cacheState: 'idle' | 'loading' | 'cache-hit' | 'server-cache-hit' | 're-analysis' | 'error' = 'idle';
  isStale = false;
  isCached = false;

  // Analysis result
  analysis: ResumeAnalysis | null = null;
  errorMessage = '';
  contentQualityWarning = '';

  // Authoritative metrics & viewmodels
  overallScore: number | null = null;
  overallScoreAvailable = false;
  scoreCardColor: ScoreCardColor = 'purple';
  scoreRuleVersion = 'resume-overall-score-v1';
  scoreCalculatedAt: string | null = null;

  // Readability & content quality
  contentQualityState: ResumeContentQualityState | null = null;
  qualityIndicator: QualityIndicatorConfig | null = null;

  // Breakdown & Evidence
  breakdownDimensions: DisplayBreakdownDimension[] = [];
  sectionPresenceList: SectionPresenceItem[] = [];
  skillGroups: SkillGroupViewModel[] = [];
  detectedSkillCount = 0;
  quantifiedAchievementsCount = 0;
  quantifiedAchievementExamples: string[] = [];
  experienceYears: number | null = null;
  experienceLevel: string | null = null;
  detectedWordCount: number | null = null;
  uniqueWordCount: number | null = null;
  warningsList: ResumeWarning[] = [];
  showAllSkills = false;

  // AI Guidance
  aiGuidanceAvailable = false;
  aiStrengths: string[] = [];
  aiWeaknesses: string[] = [];
  aiWritingSuggestions: string[] = [];
  aiPriorities: Array<{ title: string; description: string; impact: string }> = [];
  aiExecutiveSummary = '';
  hiringReadiness = '';

  private readonly uploadSubject$ = new Subject<File>();

  ngOnInit(): void {
    this.setupUploadPipeline();
    this.subscribeToResumeLibrary();
    this.loadInitialContext();
  }

  private setupUploadPipeline(): void {
    this.uploadSubject$.pipe(
      takeUntilDestroyed(this.destroyRef),
      filter(() => !this.isUploading && !this.isAnalyzing),
      exhaustMap((file) => {
        this.isUploading = true;
        this.isAnalyzing = true;
        this.errorMessage = '';
        this.contentQualityWarning = '';
        this.cdr.detectChanges();

        const formData = new FormData();
        formData.append('resume', file);

        return this.apiService.uploadResume(formData).pipe(
          switchMap((uploadRes) => {
            const uploadedFileId = uploadRes?.fileId;
            if (!uploadedFileId) throw new Error('Upload succeeded but no file ID was returned.');
            this.selectedResumeFileId = uploadedFileId;
            this.activeResumeFileId = uploadedFileId;
            this.activeResumeFileName = uploadRes?.fileName || file.name;
            this.viewedResumeFileName = uploadRes?.fileName || file.name;
            this.viewedResumeFileId = uploadedFileId;

            // Immediately analyze uploaded resume
            return this.apiService.analyzeResume(uploadedFileId, false);
          }),
          tap((analysisRes) => {
            this.isUploading = false;
            this.isAnalyzing = false;
            this.applyAnalysis(analysisRes, 'idle');
            this.refreshResumeFiles();
          }),
          catchError((err) => {
            this.isUploading = false;
            this.isAnalyzing = false;
            this.handleUploadError(err);
            this.cdr.detectChanges();
            return of(null);
          })
        );
      })
    ).subscribe();
  }

  private subscribeToResumeLibrary(): void {
    this.resumeService.resumes$.pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe((files) => {
      this.resumeFiles = Array.isArray(files) ? files : [];
      if (!this.selectedResumeFileId && this.resumeFiles.length > 0) {
        const active = this.resumeFiles.find((f) => f.isActive) || this.resumeFiles.find((f) => f.isDefault) || this.resumeFiles[0];
        this.selectedResumeFileId = active.fileId;
      }
      this.cdr.detectChanges();
    });
  }

  private loadInitialContext(): void {
    this.isLoadingAnalysis = true;
    this.errorMessage = '';
    this.cdr.detectChanges();

    this.apiService.getActiveResumeContext().pipe(
      takeUntilDestroyed(this.destroyRef),
      switchMap((activeCtx) => {
        const activeFile = activeCtx?.activeResume || activeCtx?.defaultResume;
        if (activeFile?.fileId) {
          this.activeResumeFileId = activeFile.fileId;
          this.defaultResumeFileId = activeCtx?.defaultResume?.fileId || activeFile.fileId;
          this.activeResumeFileName = activeFile.fileName || '';
          this.selectedResumeFileId = activeFile.fileId;
          this.viewedResumeFileName = activeFile.fileName || '';
          this.viewedResumeFileId = activeFile.fileId;

          // Attempt to load analysis for the active resume
          return this.apiService.getResumeAnalysis(activeFile.fileId).pipe(
            catchError((err) => {
              if (err?.status === 404) {
                // Active resume is not analyzed yet
                this.isUnanalyzedSelected = true;
                this.analysisComplete = false;
                this.hasNoData = false;
                return of(null);
              }
              throw err;
            })
          );
        } else {
          // No active resume found in context
          return this.apiService.getResumeFiles().pipe(
            switchMap((filesRes) => {
              const files: ResumeFile[] = Array.isArray(filesRes?.files) ? filesRes.files : [];
              this.resumeFiles = files;
              if (files.length > 0) {
                const first = files[0];
                this.selectedResumeFileId = first.fileId;
                this.viewedResumeFileName = first.fileName;
                this.viewedResumeFileId = first.fileId;
                if (first.isAnalyzed) {
                  return this.apiService.getResumeAnalysis(first.fileId);
                } else {
                  this.isUnanalyzedSelected = true;
                  return of(null);
                }
              }
              this.hasNoData = true;
              return of(null);
            })
          );
        }
      }),
      tap((analysis) => {
        this.isLoadingAnalysis = false;
        if (analysis) {
          this.applyAnalysis(analysis, analysis?.cacheMetadata?.loadedFromCache ? 'server-cache-hit' : 'idle');
        }
        this.refreshResumeFiles();
        this.cdr.detectChanges();
      }),
      catchError((err) => {
        this.isLoadingAnalysis = false;
        if (err?.status === 404) {
          this.hasNoData = true;
        } else {
          this.errorMessage = err?.error?.message || 'Could not load resume data.';
        }
        this.cdr.detectChanges();
        return of(null);
      })
    ).subscribe();
  }

  refreshResumeFiles(): void {
    this.apiService.getResumeFiles().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (res) => {
        this.resumeFiles = Array.isArray(res?.files) ? res.files : [];
        this.cdr.detectChanges();
      },
      error: () => {}
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      this.errorMessage = 'Only PDF files are supported. Please select a valid .pdf resume.';
      input.value = '';
      this.cdr.detectChanges();
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      this.errorMessage = 'The file exceeds the 10 MB limit. Please upload a smaller PDF resume.';
      input.value = '';
      this.cdr.detectChanges();
      return;
    }

    this.errorMessage = '';
    this.uploadSubject$.next(file);
    input.value = '';
  }

  useSelectedResume(setAsDefault = false): void {
    if (!this.selectedResumeFileId || this.isLoadingAnalysis || this.isAnalyzing) return;

    const file = this.resumeFiles.find((f) => f.fileId === this.selectedResumeFileId);
    if (!file) return;

    this.isLoadingAnalysis = true;
    this.errorMessage = '';
    this.viewedResumeFileName = file.fileName;
    this.viewedResumeFileId = file.fileId;
    this.cdr.detectChanges();

    if (setAsDefault) {
      this.apiService.setActiveResume(file.fileId, true).pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => this.apiService.getResumeAnalysis(file.fileId)),
        catchError((err) => {
          if (err?.status === 404) {
            this.isUnanalyzedSelected = true;
            this.analysisComplete = false;
            return of(null);
          }
          throw err;
        })
      ).subscribe({
        next: (analysis) => {
          this.isLoadingAnalysis = false;
          this.defaultResumeFileId = file.fileId;
          this.activeResumeFileId = file.fileId;
          this.refreshResumeFiles();
          if (analysis) {
            this.applyAnalysis(analysis, 'idle');
          }
          this.cdr.detectChanges();
        },
        error: (err) => {
          this.isLoadingAnalysis = false;
          this.errorMessage = err?.error?.message || 'Could not set active resume.';
          this.cdr.detectChanges();
        }
      });
      return;
    }

    // View analysis of selected file
    this.apiService.getResumeAnalysis(file.fileId).pipe(
      takeUntilDestroyed(this.destroyRef),
      catchError((err) => {
        if (err?.status === 404) {
          this.isUnanalyzedSelected = true;
          this.analysisComplete = false;
          this.analysis = null;
          return of(null);
        }
        throw err;
      })
    ).subscribe({
      next: (analysis) => {
        this.isLoadingAnalysis = false;
        if (analysis) {
          this.applyAnalysis(analysis, 'idle');
        }
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isLoadingAnalysis = false;
        this.errorMessage = err?.error?.message || 'Failed to load analysis for selected resume.';
        this.cdr.detectChanges();
      }
    });
  }

  analyzeSelectedResume(forceRefresh = false): void {
    const fileId = this.selectedResumeFileId || this.viewedResumeFileId;
    if (!fileId || this.isAnalyzing || this.isLoadingAnalysis) return;

    this.isAnalyzing = true;
    this.errorMessage = '';
    this.contentQualityWarning = '';
    this.cacheState = forceRefresh ? 're-analysis' : 'loading';
    this.cdr.detectChanges();

    this.apiService.analyzeResume(fileId, forceRefresh).pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (res) => {
        this.isAnalyzing = false;
        const payload = res?.responsePayload || res;
        this.applyAnalysis(payload, forceRefresh ? 'idle' : (payload?.cacheMetadata?.loadedFromCache ? 'server-cache-hit' : 'idle'));
        this.refreshResumeFiles();
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isAnalyzing = false;
        this.cacheState = 'error';
        this.handleUploadError(err);
        this.cdr.detectChanges();
      }
    });
  }

  downloadGuide(): void {
    if (this.isDownloading) return;
    this.isDownloading = true;
    this.errorMessage = '';
    this.cdr.detectChanges();

    this.apiService.downloadResumeGuide().pipe(
      takeUntilDestroyed(this.destroyRef)
    ).subscribe({
      next: (blob) => {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const name = (this.viewedResumeFileName || 'resume-guide').replace(/\.pdf$/i, '');
        a.download = `resume-guide-${name}.html`;
        a.click();
        window.URL.revokeObjectURL(url);
        this.isDownloading = false;
        this.cdr.detectChanges();
      },
      error: (err) => {
        this.isDownloading = false;
        this.errorMessage = err?.error?.message || 'Failed to generate resume guide. Please try again.';
        this.cdr.detectChanges();
      }
    });
  }

  private applyAnalysis(analysis: ResumeAnalysis, cacheHitState: 'idle' | 'cache-hit' | 'server-cache-hit' | 're-analysis'): void {
    this.analysis = analysis;
    this.analysisComplete = true;
    this.hasNoData = false;
    this.isUnanalyzedSelected = false;
    this.cacheState = cacheHitState;
    this.viewedResumeFileName = analysis.fileName || this.viewedResumeFileName;
    this.viewedResumeFileId = analysis.fileId || this.viewedResumeFileId;

    // Cache / Freshness metadata
    this.isCached = Boolean(analysis.cacheMetadata?.loadedFromCache || cacheHitState === 'server-cache-hit');
    this.isStale = Boolean(analysis.cacheMetadata?.loadedFromCache);

    // Authoritative Overall Score (scoring.score)
    this.scoreRuleVersion = analysis.scoring?.ruleVersion || 'resume-overall-score-v1';
    this.scoreCalculatedAt = analysis.scoring?.calculatedAt || analysis.analyzedAt || null;

    if (analysis.scoring && analysis.scoring.score !== null && analysis.scoring.score !== undefined) {
      this.overallScore = Math.max(0, Math.min(100, Math.round(Number(analysis.scoring.score))));
      this.overallScoreAvailable = true;
      this.scoreCardColor = this.overallScore >= 75 ? 'green' : (this.overallScore >= 50 ? 'purple' : 'amber');
    } else {
      this.overallScore = null;
      this.overallScoreAvailable = false;
      this.scoreCardColor = 'amber';
    }

    // Content Quality State
    this.contentQualityState = analysis.contentQualityState || null;
    this.qualityIndicator = this.buildQualityIndicator(this.contentQualityState?.state || 'VALID');

    // Build the 8-component breakdown
    this.breakdownDimensions = this.buildBreakdownDimensions(analysis);

    // Section presence evidence
    this.sectionPresenceList = this.buildSectionPresence(analysis.normalized?.sectionPresence);

    // Extracted Skills
    this.skillGroups = this.buildSkillGroups(analysis.skills, analysis.technologyCategories);
    this.detectedSkillCount = this.calculateUniqueSkillCount(this.skillGroups);

    // Quantified Achievements Evidence
    const evidenceFacts = analysis.scoring?.evidence?.facts || {};
    this.quantifiedAchievementsCount = Number(evidenceFacts['quantifiedAchievementCount'] || analysis.keyAchievements?.length || 0);
    this.quantifiedAchievementExamples = Array.isArray(analysis.keyAchievements) ? analysis.keyAchievements : [];

    // Experience Years & Level
    this.experienceYears = analysis.experienceYears ?? (analysis.normalized?.experienceYears ?? null);
    this.experienceLevel = analysis.experienceLevel || (analysis.normalized?.experienceLevel || null);

    // Document token metrics
    this.detectedWordCount = this.contentQualityState?.wordCount ?? (evidenceFacts['wordCount'] as number ?? null);
    this.uniqueWordCount = this.contentQualityState?.uniqueWordCount ?? null;

    // Consistency Warnings
    this.warningsList = Array.isArray(analysis.consistencyWarnings) ? analysis.consistencyWarnings : [];

    // AI Advisory Guidance (Separated from deterministic facts)
    this.setupAiGuidance(analysis);

    this.cdr.detectChanges();
  }

  private buildQualityIndicator(state: ContentQualityStatus): QualityIndicatorConfig {
    switch (state) {
      case 'VALID':
        return {
          label: 'Valid Structure',
          badgeVariant: 'success',
          title: 'Resume parsed successfully',
          description: 'Document structure and machine readability met all standard sufficiency checks.',
          recoveryCta: null
        };
      case 'PARTIALLY_READABLE':
        return {
          label: 'Partially Readable',
          badgeVariant: 'warning',
          title: 'Partial text extraction',
          description: 'Not enough readable text or sections found to score reliably. Score is marked Unavailable.',
          recoveryCta: 'Upload a text-based PDF containing your full professional experience and project achievements.'
        };
      case 'UNREADABLE':
        return {
          label: 'Unreadable Content',
          badgeVariant: 'danger',
          title: 'Resume appears image-only or unreadable',
          description: 'Machine text could not be extracted. Scanned PDFs or non-standard font encodings cannot be parsed.',
          recoveryCta: 'Export your resume directly from your word processor as a standard text-based PDF.'
        };
      case 'EMPTY':
        return {
          label: 'Empty Document',
          badgeVariant: 'danger',
          title: 'No text found in document',
          description: 'The uploaded file contains no extractable text layer.',
          recoveryCta: 'Ensure the PDF has selectable text and try uploading again.'
        };
      case 'INVALID':
      default:
        return {
          label: 'Invalid Format',
          badgeVariant: 'danger',
          title: 'Document could not be parsed',
          description: 'The file signature or PDF structure was invalid.',
          recoveryCta: 'Ensure the file is a valid PDF under 10 MB and retry.'
        };
    }
  }

  private buildBreakdownDimensions(analysis: ResumeAnalysis): DisplayBreakdownDimension[] {
    const breakdown = analysis.scoring?.breakdown || {};
    const fallbackExplanations = (analysis.qualityScores?.['explanations'] || {}) as Record<string, string>;

    return Object.keys(DIMENSION_METADATA).map((key) => {
      const meta = DIMENSION_METADATA[key];
      const item: ResumeScoringBreakdownItem | undefined = breakdown[key];

      let value: number | null = null;
      let contribution: number | null = null;
      let available = false;
      let explanation = meta.description;

      if (item) {
        available = Boolean(item.available);
        value = available ? Math.max(0, Math.min(100, Math.round(Number(item.score)))) : null;
        contribution = available ? Math.round(Number(item.contribution) * 10) / 10 : null;
        explanation = item.explanation || fallbackExplanations[key] || meta.description;
      } else {
        // Legacy fallback
        const legacyVal = (analysis as any)[key] ?? analysis.qualityScores?.[key];
        if (Number.isFinite(legacyVal)) {
          value = Math.max(0, Math.min(100, Math.round(Number(legacyVal))));
          contribution = Math.round((value * (meta.weight / 100)) * 10) / 10;
          available = true;
        }
      }

      return {
        key,
        label: meta.label,
        description: meta.description,
        weightPct: meta.weight,
        value,
        contribution,
        available,
        explanation,
        tone: meta.tone
      };
    });
  }

  private buildSectionPresence(sections?: Record<string, boolean>): SectionPresenceItem[] {
    const checks: Array<{ key: string; label: string }> = [
      { key: 'experience', label: 'Work Experience' },
      { key: 'projects', label: 'Projects' },
      { key: 'skills', label: 'Technical Skills' },
      { key: 'education', label: 'Education' },
      { key: 'certifications', label: 'Certifications' }
    ];

    if (!sections) return checks.map((c) => ({ ...c, present: false }));

    return checks.map((c) => ({
      key: c.key,
      label: c.label,
      present: Boolean(sections[c.key])
    }));
  }

  private buildSkillGroups(skillsMap?: Record<string, string[]>, techMap?: Record<string, string[]>): SkillGroupViewModel[] {
    const merged = new Map<string, Set<string>>();

    const addEntries = (dict?: Record<string, string[]>) => {
      if (!dict || typeof dict !== 'object') return;
      Object.entries(dict).forEach(([cat, list]) => {
        if (!Array.isArray(list)) return;
        const categoryKey = cat.replace(/[_-]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        if (!merged.has(categoryKey)) merged.set(categoryKey, new Set());
        const set = merged.get(categoryKey)!;
        list.forEach((s) => {
          if (typeof s === 'string' && s.trim()) set.add(s.trim());
        });
      });
    };

    addEntries(skillsMap);
    addEntries(techMap);

    return Array.from(merged.entries())
      .map(([category, set]) => ({
        category,
        skills: Array.from(set).sort()
      }))
      .filter((group) => group.skills.length > 0)
      .sort((a, b) => b.skills.length - a.skills.length);
  }

  private calculateUniqueSkillCount(groups: SkillGroupViewModel[]): number {
    const unique = new Set<string>();
    groups.forEach((g) => g.skills.forEach((s) => unique.add(s.toLowerCase())));
    return unique.size;
  }

  private setupAiGuidance(analysis: ResumeAnalysis): void {
    const ai = analysis.aiInsights;
    this.aiGuidanceAvailable = Boolean(ai && ai.aiUsed !== false);

    this.aiStrengths = Array.isArray(ai?.strengths) && ai.strengths.length > 0
      ? ai.strengths
      : (Array.isArray(analysis.recruiterPerspective?.strengths) ? analysis.recruiterPerspective.strengths : []);

    this.aiWeaknesses = Array.isArray(ai?.weaknesses) && ai.weaknesses.length > 0
      ? ai.weaknesses
      : (Array.isArray(analysis.recruiterPerspective?.concerns) ? analysis.recruiterPerspective.concerns : []);

    this.aiWritingSuggestions = Array.isArray(ai?.writingSuggestions) && ai.writingSuggestions.length > 0
      ? ai.writingSuggestions
      : (Array.isArray(analysis.suggestions) ? analysis.suggestions.map((s) => `${s.title}: ${s.description}`) : []);

    if (Array.isArray(ai?.priorities) && ai.priorities.length > 0) {
      this.aiPriorities = ai.priorities;
    } else if (Array.isArray(analysis.suggestions)) {
      this.aiPriorities = analysis.suggestions.map((s) => ({
        title: s.title,
        description: s.description,
        impact: s.color === 'red' ? 'high' : (s.color === 'orange' ? 'medium' : 'low')
      }));
    } else {
      this.aiPriorities = [];
    }

    this.aiExecutiveSummary = ai?.executiveSummary || analysis.recruiterPerspective?.resumeSummary || '';
    this.hiringReadiness = analysis.recruiterPerspective?.hiringReadiness || '';
  }

  private handleUploadError(err: any): void {
    const status = Number(err?.status || err?.statusCode || 0);
    const contentState = err?.error?.contentQualityState;

    if (contentState) {
      this.contentQualityState = contentState;
      this.qualityIndicator = this.buildQualityIndicator(contentState.state);
      this.contentQualityWarning = err?.error?.message || 'The resume content could not be processed.';
      return;
    }

    if (status === 413) {
      this.errorMessage = 'The resume file is too large. Upload a PDF of 10 MB or smaller.';
    } else if (status === 400) {
      this.errorMessage = err?.error?.message || 'Invalid resume file. Only text-based PDF documents are accepted.';
    } else if (status === 422) {
      this.errorMessage = err?.error?.message || 'Could not parse text from this resume. Please upload a standard text PDF.';
    } else {
      this.errorMessage = err?.error?.message || 'An unexpected error occurred while processing the resume.';
    }
  }

  toggleAllSkills(): void {
    this.showAllSkills = !this.showAllSkills;
    this.cdr.detectChanges();
  }

  formatDate(dateVal?: string | Date | null): string {
    if (!dateVal) return 'Unknown date';
    try {
      const d = new Date(dateVal);
      return isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      });
    } catch {
      return 'Unknown date';
    }
  }

  formatFileSize(bytes?: number): string {
    if (!bytes || bytes <= 0) return '0 KB';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${Math.round(bytes / 1024)} KB`;
  }
}
