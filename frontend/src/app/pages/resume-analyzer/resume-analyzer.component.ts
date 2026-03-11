import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
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
  analysisComplete: boolean = false;
  hasNoData: boolean = false;        // true when backend confirmed no resume yet

  // Resume analysis data
  analysis: ResumeAnalysis | null = null;
  errorMessage: string = '';

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

  constructor(private readonly apiService: ApiService) {}

  ngOnInit() {
    this.loadPreviousAnalysis();
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
      },
      error: (err) => {
        // 404 = no resume uploaded yet; any other = also show empty state
        this.analysisComplete = false;
        this.hasNoData = true;
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
    this.isAnalyzing = true;
    this.errorMessage = '';
    
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
          },
          error: (err) => {
            this.isAnalyzing = false;
            this.errorMessage = err.error?.message || 'Failed to analyze resume. Please try again.';
            console.error(err);
          }
        });
      },
      error: (err) => {
        this.isAnalyzing = false;
        this.errorMessage = err.error?.message || 'Failed to upload resume. Please ensure you are logged in.';
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
}
