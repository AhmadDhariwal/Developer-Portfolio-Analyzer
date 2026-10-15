import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';

import { ResumeAnalyzerComponent } from './resume-analyzer.component';
import { ApiService } from '../../shared/services/api.service';
import { ResumeService, ResumeFile } from '../../shared/services/resume.service';
import { ResumeAnalysis } from '../../shared/models/resume.model';

describe('ResumeAnalyzerComponent', () => {
  let component: ResumeAnalyzerComponent;
  let fixture: ComponentFixture<ResumeAnalyzerComponent>;

  let apiServiceMock: {
    getActiveResumeContext: ReturnType<typeof vi.fn>;
    getResumeFiles: ReturnType<typeof vi.fn>;
    getResumeAnalysis: ReturnType<typeof vi.fn>;
    analyzeResume: ReturnType<typeof vi.fn>;
    uploadResume: ReturnType<typeof vi.fn>;
    setActiveResume: ReturnType<typeof vi.fn>;
    downloadResumeGuide: ReturnType<typeof vi.fn>;
  };

  let resumeServiceMock: {
    resumes$: ReturnType<typeof vi.fn>;
    profile$: ReturnType<typeof vi.fn>;
  };

  const sampleFiles: ResumeFile[] = [
    {
      fileId: 'file-111',
      fileName: 'main-resume.pdf',
      fileSize: 102400,
      uploadDate: '2026-10-01T12:00:00.000Z',
      isAnalyzed: true,
      isDefault: true,
      isActive: true,
      resumeHash: 'hash-111',
      analysisVersion: 'resume-intel-v2'
    },
    {
      fileId: 'file-222',
      fileName: 'older-resume.pdf',
      fileSize: 98000,
      uploadDate: '2026-09-15T10:00:00.000Z',
      isAnalyzed: false,
      isDefault: false,
      isActive: false
    }
  ];

  const sampleValidAnalysis: ResumeAnalysis = {
    fileId: 'file-111',
    fileName: 'main-resume.pdf',
    fileSize: 102400,
    uploadDate: '2026-10-01T12:00:00.000Z',
    analyzedAt: '2026-10-08T10:00:00.000Z',
    resumeHash: 'hash-111',
    analysisVersion: 'resume-overall-score-v1',

    // Authoritative score: 85 (differs from legacy atsScore 70)
    scoring: {
      score: 85,
      ruleVersion: 'resume-overall-score-v1',
      calculatedAt: '2026-10-08T10:00:00.000Z',
      warnings: [],
      evidence: {
        sources: [{ type: 'resume-file', id: 'file-111' }],
        inputs: {},
        facts: {
          quantifiedAchievementCount: 4,
          technologyCount: 15,
          sectionCount: 5,
          experienceYears: 4,
          wordCount: 320
        }
      },
      breakdown: {
        atsScore: { score: 70, weight: 0.18, contribution: 12.6, available: true, explanation: 'Standard ATS headings' },
        contentQuality: { score: 88, weight: 0.16, contribution: 14.1, available: true, explanation: 'Strong action verbs' },
        keywordDensity: { score: 80, weight: 0.12, contribution: 9.6, available: true, explanation: 'Balanced terminology' },
        formatScore: { score: 90, weight: 0.12, contribution: 10.8, available: true, explanation: 'Clean bullet structure' },
        projectQuality: { score: 84, weight: 0.12, contribution: 10.1, available: true, explanation: 'Full-stack delivery evidence' },
        experienceStrength: { score: 92, weight: 0.12, contribution: 11.0, available: true, explanation: 'Quantified metrics present' },
        skillsCoverage: { score: 85, weight: 0.10, contribution: 8.5, available: true, explanation: 'Broad modern stack' },
        technicalDepth: { score: 0, weight: 0.08, contribution: 0.0, available: true, explanation: 'Zero deep systems measured' }
      }
    },

    contentQualityState: {
      state: 'VALID',
      scoreable: true,
      wordCount: 320,
      uniqueWordCount: 140
    },

    // Legacy scores
    atsScore: 70,
    keywordDensity: 80,
    formatScore: 90,
    contentQuality: 88,

    skills: {
      Frontend: ['Angular', 'TypeScript', 'SCSS'],
      Backend: ['Node.js', 'Express', 'MongoDB']
    },
    experienceYears: 4,
    experienceLevel: 'Mid-Level',
    keyAchievements: [
      'Reduced latency by 30% for 10,000 active users',
      'Improved test coverage to 85% across core APIs'
    ],
    suggestions: [
      { id: '1', title: 'Add CI/CD pipelines', description: 'Showcase GitHub Actions experience', color: 'orange' }
    ],
    normalized: {
      sectionPresence: {
        experience: true,
        projects: true,
        skills: true,
        education: true,
        certifications: false
      }
    },
    aiInsights: {
      aiUsed: true,
      strengths: ['Clear enterprise Angular ownership', 'Demonstrated API performance improvements'],
      weaknesses: ['Add DevOps automation tools'],
      writingSuggestions: ['Highlight cross-functional leadership in team projects'],
      priorities: [
        { title: 'Quantify team scaling impact', description: 'Mention mentorship of junior engineers', impact: 'high' }
      ]
    }
  };

  beforeEach(async () => {
    apiServiceMock = {
      getActiveResumeContext: vi.fn().mockReturnValue(of({
        activeResume: sampleFiles[0],
        defaultResume: sampleFiles[0]
      })),
      getResumeFiles: vi.fn().mockReturnValue(of({ files: sampleFiles })),
      getResumeAnalysis: vi.fn().mockReturnValue(of(sampleValidAnalysis)),
      analyzeResume: vi.fn().mockReturnValue(of(sampleValidAnalysis)),
      uploadResume: vi.fn().mockReturnValue(of({
        fileId: 'file-333',
        fileName: 'new-uploaded.pdf',
        fileSize: 150000,
        contentQualityState: { state: 'VALID', scoreable: true }
      })),
      setActiveResume: vi.fn().mockReturnValue(of({ message: 'Active resume updated', fileId: 'file-222' })),
      downloadResumeGuide: vi.fn().mockReturnValue(of(new Blob(['<html>Guide</html>'], { type: 'text/html' })))
    };

    resumeServiceMock = {
      resumes$: of(sampleFiles) as any,
      profile$: of(null) as any
    };

    await TestBed.configureTestingModule({
      imports: [ResumeAnalyzerComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: apiServiceMock },
        { provide: ResumeService, useValue: resumeServiceMock }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ResumeAnalyzerComponent);
    component = fixture.componentInstance;
  });

  it('should initialize and load active resume analysis', () => {
    fixture.detectChanges();

    expect(apiServiceMock.getActiveResumeContext).toHaveBeenCalled();
    expect(apiServiceMock.getResumeAnalysis).toHaveBeenCalledWith('file-111');
    expect(component.analysisComplete).toBe(true);
    expect(component.hasNoData).toBe(false);
    expect(component.overallScore).toBe(85);
  });

  it('should treat scoring.score as the authoritative overall score and not confuse it with legacy atsScore', () => {
    fixture.detectChanges();

    // Authoritative score is 85 from scoring.score
    expect(component.overallScore).toBe(85);
    expect(component.overallScoreAvailable).toBe(true);
    // Legacy atsScore is 70, which should remain an individual sub-dimension
    expect(component.analysis?.atsScore).toBe(70);
    const atsDimension = component.breakdownDimensions.find(d => d.key === 'atsScore');
    expect(atsDimension?.value).toBe(70);
    expect(atsDimension?.weightPct).toBe(18);
  });

  it('should display Unable to score reliably / Unavailable when scoring.score is null rather than 0/100', () => {
    const unscoreableAnalysis: ResumeAnalysis = {
      ...sampleValidAnalysis,
      scoring: {
        score: null, // Unscoreable / Partially readable
        ruleVersion: 'resume-overall-score-v1',
        calculatedAt: '2026-10-08T10:00:00.000Z',
        warnings: ['score_unavailable'],
        evidence: { facts: {} },
        breakdown: {}
      },
      contentQualityState: {
        state: 'PARTIALLY_READABLE',
        scoreable: false,
        wordCount: 25,
        uniqueWordCount: 8
      }
    };

    apiServiceMock.getResumeAnalysis.mockReturnValue(of(unscoreableAnalysis));
    fixture.detectChanges();

    expect(component.overallScore).toBeNull();
    expect(component.overallScoreAvailable).toBe(false);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('app-score-card')).toBeNull();
    expect(compiled.querySelector('.unavailable-score-card')).toBeTruthy();
    expect(compiled.textContent).toContain('Unable to score reliably / Unavailable');
    expect(compiled.textContent).toContain('Score Unavailable');
  });

  it('should show onboarding empty state when user has no resumes', () => {
    apiServiceMock.getActiveResumeContext.mockReturnValue(of({ activeResume: null, defaultResume: null }));
    apiServiceMock.getResumeFiles.mockReturnValue(of({ files: [] }));
    apiServiceMock.getResumeAnalysis.mockReturnValue(throwError(() => ({ status: 404 })));

    fixture.detectChanges();

    expect(component.hasNoData).toBe(true);
    expect(component.analysisComplete).toBe(false);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Upload your first resume');
  });

  it('should distinguish selected but unanalyzed resume and offer analyze CTA', () => {
    apiServiceMock.getActiveResumeContext.mockReturnValue(of({
      activeResume: sampleFiles[1], // unanalyzed file
      defaultResume: sampleFiles[0]
    }));
    apiServiceMock.getResumeAnalysis.mockReturnValue(throwError(() => ({ status: 404 })));

    fixture.detectChanges();

    expect(component.isUnanalyzedSelected).toBe(true);
    expect(component.analysisComplete).toBe(false);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Selected resume has not been analyzed yet');
  });

  it('should switch active resume context without losing historical files', () => {
    fixture.detectChanges();

    component.selectedResumeFileId = 'file-222';
    apiServiceMock.getResumeAnalysis.mockReturnValue(of({
      ...sampleValidAnalysis,
      fileId: 'file-222',
      fileName: 'older-resume.pdf'
    }));

    component.useSelectedResume(true);

    expect(apiServiceMock.setActiveResume).toHaveBeenCalledWith('file-222', true);
    expect(component.resumeFiles.length).toBe(2);
  });

  it('should accurately present readability quality state and recovery guidance', () => {
    const partiallyReadableAnalysis: ResumeAnalysis = {
      ...sampleValidAnalysis,
      scoring: { ...sampleValidAnalysis.scoring!, score: null },
      contentQualityState: {
        state: 'PARTIALLY_READABLE',
        scoreable: false,
        wordCount: 22,
        uniqueWordCount: 9
      }
    };

    apiServiceMock.getResumeAnalysis.mockReturnValue(of(partiallyReadableAnalysis));
    fixture.detectChanges();

    expect(component.qualityIndicator?.label).toBe('Partially Readable');
    expect(component.qualityIndicator?.badgeVariant).toBe('warning');
    expect(component.qualityIndicator?.recoveryCta).toContain('Upload a text-based PDF');
  });

  it('should handle unreadable error response gracefully with document notice banner', () => {
    fixture.detectChanges();

    const badFile = new File(['%PDF-empty'], 'corrupt.pdf', { type: 'application/pdf' });
    apiServiceMock.uploadResume.mockReturnValue(throwError(() => ({
      status: 422,
      error: {
        message: 'The resume text is unreadable or too short. Upload a readable text-based PDF.',
        contentQualityState: { state: 'UNREADABLE', scoreable: false }
      }
    })));

    const inputEvent = {
      target: {
        files: [badFile],
        value: ''
      }
    } as unknown as Event;

    component.onFileSelected(inputEvent);

    expect(component.contentQualityWarning).toContain('unreadable or too short');
    expect(component.qualityIndicator?.label).toBe('Unreadable Content');
  });

  it('should validate client-side before sending non-PDF or oversized files', () => {
    fixture.detectChanges();

    // 1. Non-PDF file
    const txtFile = new File(['hello'], 'resume.txt', { type: 'text/plain' });
    component.onFileSelected({ target: { files: [txtFile], value: '' } } as unknown as Event);
    expect(component.errorMessage).toContain('Only PDF files are supported');
    expect(apiServiceMock.uploadResume).not.toHaveBeenCalled();

    // 2. Oversized file (>10MB)
    const largeFile = new File([new ArrayBuffer(11 * 1024 * 1024)], 'large.pdf', { type: 'application/pdf' });
    Object.defineProperty(largeFile, 'size', { value: 11 * 1024 * 1024 });
    component.onFileSelected({ target: { files: [largeFile], value: '' } } as unknown as Event);
    expect(component.errorMessage).toContain('exceeds the 10 MB limit');
  });

  it('should distinguish measured zero from unavailable in score breakdown', () => {
    fixture.detectChanges();

    // In sampleValidAnalysis:
    // technicalDepth has score: 0 and available: true -> measured zero
    const technicalDepth = component.breakdownDimensions.find(d => d.key === 'technicalDepth');
    expect(technicalDepth?.value).toBe(0);
    expect(technicalDepth?.available).toBe(true);
    expect(technicalDepth?.contribution).toBe(0);
  });

  it('should keep deterministic scoring and evidence fully operational when AI fails', () => {
    const aiFailedAnalysis: ResumeAnalysis = {
      ...sampleValidAnalysis,
      aiInsights: {
        aiUsed: false // AI timed out or threw error
      }
    };

    apiServiceMock.getResumeAnalysis.mockReturnValue(of(aiFailedAnalysis));
    fixture.detectChanges();

    // Deterministic score and breakdown remain intact
    expect(component.overallScore).toBe(85);
    expect(component.breakdownDimensions.length).toBe(8);
    expect(component.aiGuidanceAvailable).toBe(false);

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('AI Narrative Advisory Temporarily Unavailable');
  });

  it('should display stale snapshot notice with original calculation date', () => {
    const cachedAnalysis: ResumeAnalysis = {
      ...sampleValidAnalysis,
      cacheMetadata: {
        loadedFromCache: true,
        analyzedAt: '2026-10-08T09:30:00.000Z'
      }
    };

    apiServiceMock.getResumeAnalysis.mockReturnValue(of(cachedAnalysis));
    fixture.detectChanges();

    expect(component.isStale).toBe(true);
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Viewing Cached Snapshot');
  });

  it('should block duplicate upload requests while in-flight', () => {
    fixture.detectChanges();

    component.isUploading = true;
    const testFile = new File(['%PDF'], 'resume.pdf', { type: 'application/pdf' });
    component.onFileSelected({ target: { files: [testFile], value: '' } } as unknown as Event);

    expect(apiServiceMock.uploadResume).not.toHaveBeenCalled();
  });

  it('should trigger resume guide report download', () => {
    fixture.detectChanges();

    const createUrlSpy = vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:test');
    const revokeUrlSpy = vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});

    component.downloadGuide();

    expect(apiServiceMock.downloadResumeGuide).toHaveBeenCalled();
    expect(createUrlSpy).toHaveBeenCalled();
    expect(revokeUrlSpy).toHaveBeenCalled();
  });
});
