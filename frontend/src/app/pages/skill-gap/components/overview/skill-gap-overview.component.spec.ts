import { TestBed, ComponentFixture } from '@angular/core/testing';
import { SkillGapOverviewComponent } from './skill-gap-overview.component';
import { SkillGapResult } from '../../../../shared/services/skill-gap.service';
import {
  EvidenceSkill,
  EvidenceStatus,
  SourceReference,
} from '../../../../shared/models/skill-gap-evidence.model';

const skill = (
  status: EvidenceStatus,
  requirement: 'REQUIRED' | 'OPTIONAL' = 'REQUIRED',
): EvidenceSkill => ({
  name: status,
  category: 'Technical',
  requirement,
  weight: 1,
  status,
  evidenceCredit: status === 'UNKNOWN' ? null : 0,
  evidenceConfidence: 'INSUFFICIENT',
  independentTechnicalSources: 0,
  evidence: [],
  warnings: [],
});
const source = (
  type: 'github' | 'resume',
  overrides: Partial<SourceReference> = {},
): SourceReference => ({
  type,
  id: `${type}-fixture`,
  available: true,
  completeness: 'COMPLETE',
  timestamp: '2026-01-01T00:00:00Z',
  freshness: 'RECORDED',
  ...overrides,
});
const snapshot = (overrides: Partial<SkillGapResult> = {}): SkillGapResult => ({
  username: 'fixture',
  careerStack: 'Full Stack',
  experienceLevel: '0-1 years',
  coverage: null,
  missing: null,
  yourSkills: [],
  missingSkills: [],
  levelAssessment: '',
  roadmap: [],
  totalWeeks: '',
  ...overrides,
});

describe('Skill Gap coverage summary', () => {
  let fixture: ComponentFixture<SkillGapOverviewComponent>;
  const render = (value: SkillGapResult) => {
    fixture.componentRef.setInput('analysis', value);
    fixture.detectChanges();
  };
  const text = () => fixture.nativeElement.textContent.replace(/\s+/g, ' ').trim();

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SkillGapOverviewComponent] });
    fixture = TestBed.createComponent(SkillGapOverviewComponent);
  });

  it('counts classified required skills without treating claims as verified or counting optional skills', () => {
    const requiredSkills = [
      'DEMONSTRATED',
      'PARTIAL',
      'CLAIMED_ONLY',
      'NOT_EVIDENCED',
      'UNKNOWN',
    ].map((status) => skill(status as EvidenceStatus));
    const value = snapshot({
      requiredSkills,
      skills: [...requiredSkills, skill('UNKNOWN', 'OPTIONAL')],
    });
    render(value);
    expect(text()).toContain('4 of 5 required skills assessed');
    expect(text()).toContain('1 unknown');
    expect(text()).toContain('not necessarily verified skills');
    expect(fixture.nativeElement.querySelector('[role=progressbar]')).toBeNull();
    expect(value.coverage).toBeNull();
    expect(value.requiredSkills?.map((entry) => entry.status)).toEqual([
      'DEMONSTRATED',
      'PARTIAL',
      'CLAIMED_ONLY',
      'NOT_EVIDENCED',
      'UNKNOWN',
    ]);
  });

  it('falls back to explicitly required skills and does not invent a denominator when breakdown is absent', () => {
    render(
      snapshot({
        requiredSkills: [],
        skills: [skill('PARTIAL'), skill('UNKNOWN'), skill('UNKNOWN', 'OPTIONAL')],
      }),
    );
    expect(text()).toContain('1 of 2 required skills assessed');
    render(snapshot());
    expect(text()).toContain('Required-skill counts are unavailable');
    expect(text()).not.toContain('0 of 0');
    expect(text()).toContain('Some source availability is not recorded');
    expect(text()).not.toContain('No usable GitHub evidence');
  });

  it('does not count an unrecognized status as assessed', () => {
    const malformed = { ...skill('UNKNOWN'), status: undefined } as unknown as EvidenceSkill;
    render(snapshot({ requiredSkills: [malformed] }));
    expect(text()).toContain('0 of 1 required skills assessed');
    expect(text()).toContain('1 unknown');
  });

  it.each([0, 25.37, 100])(
    'preserves backend coverage %s, including zero, and its progress bar',
    (coverage) => {
      render(snapshot({ coverage }));
      expect(fixture.nativeElement.querySelector('[data-testid=coverage]').textContent.trim()).toBe(
        `${coverage}%`,
      );
      expect(
        fixture.nativeElement.querySelector('[role=progressbar]').getAttribute('aria-valuenow'),
      ).toBe(String(coverage));
      expect(
        fixture.nativeElement.querySelector('[data-testid=insufficient-evidence-panel]'),
      ).toBeNull();
    },
  );

  it('treats an omitted coverage value as insufficient evidence', () => {
    const value = snapshot();
    Reflect.deleteProperty(value, 'coverage');
    render(value);
    expect(fixture.nativeElement.querySelector('[data-testid=coverage]').textContent.trim()).toBe(
      'Insufficient evidence',
    );
  });

  it('explains sampled sources from nested completeness references without promising a refresh will resolve unknowns', () => {
    render(
      snapshot({
        evidenceCompleteness: {
          githubAvailable: true,
          resumeAvailable: true,
          availableCoreSources: 2,
          totalCoreSources: 2,
          complete: false,
          sources: [source('github', { completeness: 'PARTIAL' }), source('resume')],
        },
      }),
    );
    expect(text()).toContain('Sampled GitHub evidence');
    expect(text()).toContain('Refreshing alone may leave some required skills unknown');
    expect(text()).not.toContain('No usable');
    expect(text()).not.toContain('package.json');
    expect(text()).not.toContain('Dockerfile');
  });

  it('distinguishes missing sources, explicit staleness and timestamps without a calibrated freshness threshold', () => {
    render(
      snapshot({
        sourceReferences: [
          source('github', { available: false, freshness: 'STALE' }),
          source('resume', { freshness: 'STALE' }),
        ],
      }),
    );
    expect(text()).toContain('Check GitHub:');
    expect(text()).not.toContain('Refresh GitHub:');
    expect(text()).toContain('Re-analyze Resume:');
    render(
      snapshot({
        sourceReferences: [
          source('github', { timestamp: '2000-01-01T00:00:00Z' }),
          source('resume'),
        ],
      }),
    );
    expect(text()).not.toContain('marked stale');
    expect(text()).not.toContain('No usable');
    expect(text()).not.toContain('Some source availability is not recorded');
  });

  it('uses legacy availability flags and explicit stale warnings when references are absent', () => {
    render(
      snapshot({
        evidenceCompleteness: {
          githubAvailable: false,
          resumeAvailable: true,
          availableCoreSources: 1,
          totalCoreSources: 2,
          complete: false,
          sources: [],
        },
        warnings: ['stale_source:resume'],
      }),
    );
    expect(text()).toContain('Check GitHub:');
    expect(text()).toContain('Re-analyze Resume:');
  });

  it('does not equate partial source coverage with missing sources', () => {
    render(
      snapshot({
        coverageUnavailableReason: 'partial_source_limitations',
        sourceReferences: [source('github', { completeness: 'PARTIAL' }), source('resume')],
      }),
    );
    expect(text()).toContain('Some evidence sources are incomplete or unavailable');
    expect(text()).not.toContain('Some evidence sources are unavailable.');
    expect(text()).not.toContain('No usable');
  });

  it('reuses the summary during view checks and unrelated input changes, then updates it with a new analysis', () => {
    render(snapshot({ requiredSkills: [skill('UNKNOWN')] }));
    const previous = fixture.componentInstance.summary;
    fixture.detectChanges();
    fixture.componentRef.setInput('evidenceBackedCount', 3);
    fixture.detectChanges();
    expect(fixture.componentInstance.summary).toBe(previous);
    render(snapshot({ requiredSkills: [skill('PARTIAL'), skill('CLAIMED_ONLY')] }));
    expect(fixture.componentInstance.summary).not.toBe(previous);
    expect(text()).toContain('2 of 2 required skills assessed');
    expect(text()).toContain('0 unknown');
  });
});
