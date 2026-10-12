import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { SkillGapComponent } from './skill-gap.component';
import { SkillGapService, SkillGapResult } from '../../shared/services/skill-gap.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { AuthService } from '../../shared/services/auth.service';
import { ResumeService } from '../../shared/services/resume.service';
import { RecommendationsService } from '../../shared/services/recommendations.service';
import { DEFAULT_CAREER_PROFILE } from '../../shared/models/career-profile.model';
import {
  EvidenceSkill,
  EvidenceStatus,
  SKILL_EVIDENCE_VERSION,
  STATUS_LABELS,
} from '../../shared/models/skill-gap-evidence.model';

const skill = (
  status: EvidenceStatus,
  name: string = status,
  requirement: 'REQUIRED' | 'OPTIONAL' = 'REQUIRED',
): EvidenceSkill => ({
  name,
  status,
  requirement,
  category: 'Technical',
  weight: 1,
  evidenceCredit: status === 'PARTIAL' ? 0.5 : 0,
  evidenceConfidence: status === 'PARTIAL' ? 'LOW' : 'INSUFFICIENT',
  independentTechnicalSources: 1,
  evidence:
    status === 'PARTIAL'
      ? [
          {
            kind: 'METADATA',
            type: 'github',
            id: 'repo',
            origin: 'repo',
            artifact: 'TypeScript language',
            timestamp: '2026-01-01',
            freshness: 'RECORDED',
            conflicting: false,
          },
        ]
      : [],
  warnings: [],
});
function result(coverage: number | null = 25): SkillGapResult {
  return {
    username: 'fixture',
    careerStack: 'Backend',
    experienceLevel: 'Student',
    coverage,
    missing: null,
    ruleVersion: SKILL_EVIDENCE_VERSION,
    skills: [
      skill('PARTIAL', 'TypeScript'),
      skill('CLAIMED_ONLY', 'JavaScript', 'OPTIONAL'),
      skill('NOT_EVIDENCED', 'Java'),
      skill('UNKNOWN', 'React Native'),
    ],
    requiredSkills: [],
    optionalSkills: [],
    evidenceConfidence: 'INSUFFICIENT',
    evidenceCompleteness: {
      availableCoreSources: 1,
      totalCoreSources: 2,
      githubAvailable: true,
      resumeAvailable: false,
      complete: false,
      sources: [],
    },
    sourceReferences: [
      {
        type: 'github',
        id: 'repo',
        available: true,
        completeness: 'PARTIAL',
        timestamp: '2026-01-01',
        freshness: 'STALE',
      },
    ],
    yourSkills: [],
    missingSkills: [],
    levelAssessment: '',
    roadmap: [],
    totalWeeks: '',
    aiUsed: false,
    legacyReadinessScore: 91,
    legacyConfidence: 72,
    analysisSummary: 'Injected AI claims: everyone is demonstrated.',
  };
}

describe('Skill Gap evidence presentation', () => {
  let fixture: ComponentFixture<SkillGapComponent>;
  let component: SkillGapComponent;
  let api: { analyze: ReturnType<typeof vi.fn>; clearCache: ReturnType<typeof vi.fn> };
  let profile: BehaviorSubject<any>;
  const text = () => fixture.nativeElement.textContent as string;
  beforeEach(async () => {
    profile = new BehaviorSubject({
      ...DEFAULT_CAREER_PROFILE,
      careerStack: 'Backend',
      isConfigured: true,
      activeGithubUsername: 'fixture',
    });
    api = { analyze: vi.fn(() => of(result())), clearCache: vi.fn() };
    const career = {
      careerProfile$: profile.asObservable(),
      get snapshot() {
        return profile.value;
      },
      get isConfigured() {
        return profile.value.isConfigured;
      },
      get careerStack() {
        return profile.value.careerStack;
      },
      get experienceLevel() {
        return profile.value.experienceLevel;
      },
    };
    await TestBed.configureTestingModule({
      imports: [SkillGapComponent],
      providers: [
        provideRouter([]),
        { provide: SkillGapService, useValue: api },
        { provide: CareerProfileService, useValue: career },
        {
          provide: AuthService,
          useValue: { getCurrentUser: () => ({ _id: 'user', activeGithubUsername: 'fixture' }) },
        },
        { provide: GithubService, useValue: { getActiveUsername: () => of({ username: '' }) } },
        { provide: ResumeService, useValue: {} },
        { provide: RecommendationsService, useValue: {} },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(SkillGapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });
  it.each([0, 25.37, 100, null])(
    'displays backend coverage %s without deriving or rounding it',
    (coverage) => {
      component.result = result(coverage);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid=coverage]').textContent.trim()).toBe(
        coverage === null ? 'Unavailable' : `${coverage}%`,
      );
      expect(fixture.nativeElement.querySelector('[role=progressbar]') !== null).toBe(
        coverage !== null,
      );
    },
  );
  it.each(Object.keys(STATUS_LABELS) as EvidenceStatus[])(
    'renders %s verbatim from backend',
    (status) => {
      component.result = { ...result(), skills: [skill(status)] };
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.status').textContent.trim()).toBe(
        STATUS_LABELS[status],
      );
      expect(component.skills[0].status).toBe(status);
    },
  );
  it('keeps optional designation separate and does not infer demonstrated skills from metadata, claims or AI', () => {
    expect(component.skills.some((s) => s.status === 'DEMONSTRATED')).toBe(false);
    component.requirementFilter = 'OPTIONAL';
    fixture.detectChanges();
    expect(component.visibleSkills.map((s) => s.name)).toEqual(['JavaScript']);
    expect(text()).toContain('Optional');
    expect(text()).toContain('Claimed only');
    expect(text()).not.toContain('Injected AI claims');
    expect(text()).toContain('do not provide inspected code');
  });
  it('explains not-evidenced status without asserting inability and preserves false equivalences', () => {
    expect(component.skills.map((s) => s.name)).toEqual([
      'TypeScript',
      'JavaScript',
      'Java',
      'React Native',
    ]);
    expect(text()).toContain('does not mean you lack it');
  });
  it('separates current coverage, legacy readiness and legacy confidence', () => {
    expect(text()).toContain('25%');
    expect(text()).toContain('Legacy readiness: 91%');
    expect(text()).toContain('Legacy numeric confidence: 72');
    component.result = { ...result(88), ruleVersion: 'v7' };
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid=coverage]')).toBeNull();
    expect(text()).toContain('Current skill coverage is unavailable');
  });
  it('displays source completeness, stale timestamps, per-skill confidence and weakest-required aggregate', () => {
    expect(text()).toContain('1 / 2 core sources');
    expect(text()).toContain('Partial sources');
    expect(text()).toContain('Some evidence is marked stale');
    expect(text()).toContain('Low confidence');
    expect(text()).toContain('weakest required skill');
    expect(text()).toContain('Repository metadata / dependencies');
  });
  it('shows no-evidence recovery and null score without claiming poor proficiency', () => {
    const value = result(null);
    value.evidenceCompleteness!.availableCoreSources = 0;
    component.result = value;
    fixture.detectChanges();
    expect(text()).toContain('insufficient evidence, not poor proficiency');
    expect(fixture.nativeElement.querySelectorAll('.recovery-links a').length).toBe(3);
  });
  it('renders AI text only in the separate guidance section; evidence remains unchanged', () => {
    const value = result();
    value.aiUsed = true;
    component.result = value;
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.guidance').textContent).toContain(
      'Injected AI claims',
    );
    expect(component.skills.some((s) => s.status === 'DEMONSTRATED')).toBe(false);
  });
  it('preserves previous snapshot and retry on refresh failure', () => {
    const prior = component.result;
    api.analyze.mockReturnValue(throwError(() => new Error('offline')));
    component.refreshAnalysis();
    fixture.detectChanges();
    expect(component.result).toBe(prior);
    expect(text()).toContain('Retry analysis');
    expect(text()).toContain('previous snapshot remains visible');
  });
  it('clears old results when career context changes and ignores cancelled late responses', () => {
    const pending = new Subject<SkillGapResult>();
    api.analyze.mockReturnValue(pending);
    component.refreshAnalysis();
    api.analyze.mockReturnValue(of({ ...result(50), careerStack: 'Frontend' }));
    profile.next({ ...profile.value, careerStack: 'Frontend', activeCareerStack: 'Frontend' });
    pending.next(result(99));
    fixture.detectChanges();
    expect(component.result?.coverage).toBe(50);
    expect(api.clearCache).toHaveBeenCalled();
    expect(api.analyze.mock.calls.at(-1)?.[1]).toBe('Frontend');
  });
  it('shows missing career target and does not request fallback requirements', () => {
    profile.next({ ...profile.value, isConfigured: false });
    fixture.detectChanges();
    expect(component.result).toBeNull();
    expect(text()).toContain('Choose a career target');
  });
  it('supports filtering and native keyboard-expandable evidence disclosures', () => {
    component.search = 'typescript';
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.skill-row').length).toBe(1);
    expect(fixture.nativeElement.querySelector('.skill-row summary')).toBeTruthy();
    expect(fixture.nativeElement.querySelectorAll('label select').length).toBe(3);
  });
  it('renders restored high-level metrics, category matrix, roadmap, projects, and horizons', () => {
    const rich = result(35);
    rich.categoryBreakdown = {
      Backend: {
        requiredSkillCount: 2,
        optionalSkillCount: 1,
        requiredWeight: 2,
        weightedCredit: 1,
        coverage: 50,
      },
    };
    rich.roadmap = [
      {
        phase: 'Week 1',
        title: 'Master Containerization',
        description: 'Set up Docker containers and compose.',
        duration: '1 week',
        skills: ['Docker'],
        resources: [{ title: 'Docker docs', url: 'https://docs.docker.com' }],
        objective: 'Containerize backend service',
        expectedOutcome: 'Multi-container app',
        measurableDeliverable: 'Dockerfile and compose file',
        color: 'blue',
        topSkill: 'Docker',
      },
    ];
    rich.weeklyRoadmap = [
      {
        week: 1,
        focusSkills: ['Docker'],
        reason: 'Foundation for deployment',
        outcomes: ['Build Dockerfile'],
      },
    ];
    rich.suggestedProjects = [
      {
        title: 'CI/CD Pipeline Engine',
        skill: 'CI/CD',
        difficulty: 'Intermediate',
        estimatedWeeks: 2,
        outcome: 'Automated GitHub actions workflow',
        deliverable: 'Tested workflow YAML',
      },
    ];
    rich.immediateSkills = [
      { name: 'Docker', category: 'DevOps', proficiency: null, isFoundational: false },
    ];
    rich.shortTermSkills = [
      { name: 'PostgreSQL', category: 'Database', proficiency: null, isFoundational: false },
    ];
    component.result = rich;
    fixture.detectChanges();

    // Check Metrics Cards
    expect(text()).toContain('Evidence-backed skills');
    expect(text()).toContain('Validated requirement gaps');
    expect(text()).toContain('Claims needing evidence');
    expect(text()).toContain('Learning plan timeline');

    // Check Category Matrix
    expect(text()).toContain('Category breakdown');
    expect(text()).toContain('Backend');
    expect(text()).toContain('50%');

    // Check Roadmap
    expect(text()).toContain('Master Containerization');
    expect(text()).toContain('Containerize backend service');
    expect(text()).toContain('Weekly milestones breakdown');
    expect(text()).toContain('Week 1');

    // Check Suggested Proof Projects
    expect(text()).toContain('Suggested proof projects');
    expect(text()).toContain('CI/CD Pipeline Engine');
    expect(text()).toContain('Tested workflow YAML');

    // Check Sequenced Horizons
    expect(text()).toContain('Skill acquisition horizons');
    expect(text()).toContain('Immediate');
    expect(text()).toContain('Docker');
    expect(text()).toContain('PostgreSQL');
  });

  it('supports sorting skills by name, status, and confidence', () => {
    component.sortBy = 'name';
    expect(component.visibleSkills[0].name).toBe('Java');
    component.sortBy = 'status';
    expect(component.visibleSkills[0].name).toBe('TypeScript');
    component.sortBy = 'priority';
    expect(component.visibleSkills.length).toBe(4);
  });
});
