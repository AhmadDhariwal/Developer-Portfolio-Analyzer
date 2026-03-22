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
  analysisComplete: boolean = false;
  hasNoData: boolean = false;        // true when backend confirmed no resume yet
  resumeFiles: Array<{ fileId: string; fileName: string; uploadDate: string; isAnalyzed: boolean; isDefault: boolean; isActive: boolean }> = [];
  defaultResumeFileName = '';
  activeResumeFileName = '';
  selectedResumeFileId = '';

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

  constructor(
    private readonly apiService: ApiService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  ngOnInit() {
    this.loadResumeContext();
    this.loadPreviousAnalysis();
  }

  loadResumeContext() {
    this.apiService.getActiveResumeContext().subscribe({
      next: (ctx) => {
        this.defaultResumeFileName = ctx?.defaultResume?.fileName || '';
        this.activeResumeFileName = ctx?.activeResume?.fileName || '';
        this.selectedResumeFileId = ctx?.activeResume?.fileId || '';
        this.cdr.detectChanges();
      },
      error: () => {
        this.defaultResumeFileName = '';
        this.activeResumeFileName = '';
        this.cdr.detectChanges();
      }
    });

    this.apiService.getResumeFiles().subscribe({
      next: (res) => {
        this.resumeFiles = Array.isArray(res?.files) ? res.files : [];
        if (!this.selectedResumeFileId) {
          this.selectedResumeFileId = this.resumeFiles.find((f) => f.isActive)?.fileId || '';
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
    if (!this.selectedResumeFileId) return;
    this.apiService.setActiveResume(this.selectedResumeFileId, setAsDefault).subscribe({
      next: () => {
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
    this.apiService.getResumeAnalysis().subscribe({
      next: (res) => {
        if (res && res.atsScore != null) {
          this.analysis = res;
          this.analysisComplete = true;
          this.hasNoData = false;
        } else {
          // API returned but no meaningful data
          this.analysisComplete = false;
          this.hasNoData = true;
        }
        this.cdr.detectChanges();
      },
      error: () => {
        // If no local analysis loaded, show empty state.
        // If an analysis already exists in memory, keep showing it.
        if (!this.analysis) {
          this.analysisComplete = false;
          this.hasNoData = true;
        }
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

    this.apiService.uploadResume(formData).subscribe({
      next: (uploadRes) => {
        // Now analyze the uploaded file
        this.apiService.analyzeResume(uploadRes.fileId).subscribe({
          next: (analysisRes) => {
            this.isAnalyzing = false;
            this.analysis = analysisRes;
            this.analysisComplete = true;
            this.hasNoData = false;
            this.selectedFile = null;
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
    return this.analysis.suggestions;
  }

  /**
   * Get total skills count
   */
  getTotalSkillsCount(): number {
    if (!this.analysis || !this.analysis.skills) return 0;
    return Object.values(this.analysis.skills).reduce((sum, skills) => sum + (skills?.length || 0), 0);
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
}
