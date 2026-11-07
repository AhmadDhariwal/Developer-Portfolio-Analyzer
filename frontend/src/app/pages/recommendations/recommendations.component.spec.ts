import { ChangeDetectorRef } from '@angular/core';
import { of, Subject, throwError } from 'rxjs';
import { RecommendationsComponent } from './recommendations.component';
import {
  RecommendationsService,
  RecommendationCard,
  RecommendationsResult,
} from '../../shared/services/recommendations.service';
import { GithubService } from '../../shared/services/github.service';
import { CareerProfileService } from '../../shared/services/career-profile.service';
import { FrontendAnalysisCacheService } from '../../shared/services/frontend-analysis-cache.service';
import { AuthService } from '../../shared/services/auth.service';
import { ResumeService } from '../../shared/services/resume.service';

const hash = 'a'.repeat(64);
function card(id: string, category = 'learning', priority = 'Medium'): RecommendationCard {
  return {
    id,
    category,
    priority,
    title: `Action ${id}`,
    description: 'Recorded observation',
    reason: 'Source evidence',
    evidence: ['A recorded claim'],
    evidenceStatus: 'CLAIMED_ONLY',
    sourceSignalsUsed: ['resumeSignals'],
    sources: [{ type: 'resume', available: true, freshness: 'RECORDED' }],
    confidenceScore: null,
    estimatedImpact: null,
    estimatedEffort: '',
    actionableNextStep: 'Inspect the recorded claim',
    navigation: {
      careerSprint: {
        route: '/app/career-sprint',
        api: {
          method: 'POST',
          url: `/api/recommendations/${id}/career-sprint`,
          body: { signalHash: hash },
        },
      },
    },
  };
}
function result(): RecommendationsResult {
  return {
    username: 'fixture',
    careerStack: 'Backend',
    experienceLevel: 'Student',
    projects: [],
    technologies: [],
    careerPaths: [],
    ruleVersion: 'recommendations-evidence-v1',
    recommendations: [card('z'), card('a', 'resume', 'High')],
    cacheMetadata: { signalHash: hash },
  };
}
describe('Recommendations evidence workspace', () => {
  let component: RecommendationsComponent;
  const rec = { getRecommendations: vi.fn(), handoffToSprint: vi.fn(), clearCache: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    component = new RecommendationsComponent(
      rec as unknown as RecommendationsService,
      {} as GithubService,
      {
        snapshot: { careerStack: 'Backend', experienceLevel: 'Student' },
        careerStack: 'Backend',
        experienceLevel: 'Student',
      } as CareerProfileService,
      { setCurrentSignalHash: vi.fn(), set: vi.fn() } as unknown as FrontendAnalysisCacheService,
      { getCurrentUser: () => ({ _id: 'fixture' }) } as AuthService,
      {} as ResumeService,
      { detectChanges: vi.fn() } as unknown as ChangeDetectorRef,
    );
    component.result = result();
    component.username = 'fixture';
  });
  afterEach(() => component.ngOnDestroy());
  it('preserves authoritative order even when a later card has higher priority', () => {
    expect(component.topActions.map((c) => c.id)).toEqual(['z', 'a']);
    component.search = 'recorded claim';
    expect(component.filteredCards.map((c) => c.id)).toEqual(['z', 'a']);
    component.category = 'resume';
    expect(component.filteredCards.map((c) => c.id)).toEqual(['a']);
    component.priority = 'Low';
    expect(component.filteredCards).toEqual([]);
    component.resetFilters();
    component.source = 'resume';
    expect(component.filteredCards.length).toBe(2);
  });
  it('excludes featured actions by default and restores the full authoritative order explicitly', () => {
    const cards = [card('z'), card('y'), card('x'), card('c'), card('a')];
    component.result = { ...result(), recommendations: cards };
    expect(component.explorerCards.map((c) => c.id)).toEqual(['c', 'a']);
    component.includeFeatured = true;
    expect(component.explorerCards.map((c) => c.id)).toEqual(['z', 'y', 'x', 'c', 'a']);
    expect(component.result.recommendations).toBe(cards);
    component.resetFilters();
    expect(component.includeFeatured).toBe(false);
    expect(component.allCards).toBe(cards);
  });
  it('searches featured actions too when a filter changes, and keeps raw category values', () => {
    component.search = 'Action z';
    component.visibleCount = 24;
    component.onFiltersChanged();
    expect(component.explorerCards.map((c) => c.id)).toEqual(['z']);
    expect(component.visibleCount).toBe(8);
    component.resetFilters();
    component.category = 'resume';
    component.onFiltersChanged();
    expect(component.explorerCards.map((c) => c.id)).toEqual(['a']);
    expect(component.categoryLabel('resume')).toBe('Resume');
    expect(component.allCards[1].category).toBe('resume');
  });
  it('shows only supported focus groups without generating extra actions', () => {
    expect(component.focusGroups.map((g) => g.title)).toEqual(['Skills', 'Resume']);
    expect(component.focusGroups.flatMap((g) => g.cards).map((c) => c.id)).toEqual(['z', 'a']);
    component.result!.recommendations = [];
    expect(component.focusGroups).toEqual([]);
  });
  it('keeps explicit empty recommendations authoritative over legacy projections', () => {
    component.result = {
      ...result(),
      recommendations: [],
      structuredRecommendations: { learning: [card('old')] },
    };
    expect(component.allCards).toEqual([]);
  });
  it('does not invent actions for legacy empty results', () => {
    component.result = { ...result(), recommendations: undefined };
    expect(component.legacy).toBe(true);
    expect(component.allCards).toEqual([]);
    component.result.actions = [card('saved')];
    expect(component.allCards[0].id).toBe('saved');
    expect(component.canSprint(component.allCards[0])).toBe(false);
  });
  it('preserves recorded roadmap actions when a legacy response has no recommendation list', () => {
    component.result = {
      ...result(),
      recommendations: undefined,
      roadmap: {
        immediateActions: [card('first')],
        next30Days: [card('first'), card('second')],
        next60Days: [],
        next90Days: [],
        suggestedProjects: [],
      },
    };
    expect(component.allCards.map((action) => action.id)).toEqual(['first', 'second']);
  });
  it('loads profile recommendations without requiring GitHub when other evidence may be available', () => {
    component.username = '';
    rec.getRecommendations.mockReturnValue(of({ ...result(), username: '' }));
    component.analyze(true);
    expect(rec.getRecommendations.mock.calls[0][0]).toBe('');
    expect(component.isLoading).toBe(false);
  });
  it('preserves null scores and missing source metadata through refresh', () => {
    const data = { ...result(), sourceScores: { skillEvidenceCoverage: null }, aiUsed: false };
    rec.getRecommendations.mockReturnValue(of(data));
    component.analyze(true);
    expect(component.result?.sourceScores?.['skillEvidenceCoverage']).toBeNull();
    expect(component.result?.recommendations?.[0].confidenceScore).toBeNull();
    expect(component.sourceEntries).toEqual([]);
    expect(component.result?.aiUsed).toBe(false);
  });
  it('retains previous evidence after failed refresh and supports retry', () => {
    rec.getRecommendations.mockReturnValue(throwError(() => ({ error: { message: 'Offline' } })));
    const previous = component.result;
    component.analyze(true);
    expect(component.result).toBe(previous);
    expect(component.stale).toBe(true);
    expect(component.errorMessage).toBe('Offline');
    rec.getRecommendations.mockReturnValue(of(result()));
    component.analyze(true);
    expect(component.errorMessage).toBe('');
    expect(component.isLoading).toBe(false);
  });
  it('performs handoff with id and signal hash and handles loading, duplicate, error and retry', () => {
    const response = new Subject<{ sprintId: string; alreadyAdded: boolean; route: string }>();
    rec.handoffToSprint.mockReturnValue(response);
    const action = component.allCards[0];
    component.startSprint(action);
    component.startSprint(action);
    expect(rec.handoffToSprint).toHaveBeenCalledTimes(1);
    expect(rec.handoffToSprint).toHaveBeenCalledWith('z', hash);
    expect(component.sprintStates['z'].loading).toBe(true);
    response.next({ sprintId: 'sprint', alreadyAdded: true, route: '/app/career-sprint' });
    expect(component.sprintStates['z'].message).toContain('Already');
    rec.handoffToSprint.mockReturnValue(
      throwError(() => ({ error: { message: 'Refresh before starting' } })),
    );
    component.startSprint(action);
    expect(component.sprintStates['z'].success).toBe(false);
    expect(component.sprintStates['z'].message).toBe('Refresh before starting');
    rec.handoffToSprint.mockReturnValue(
      of({ alreadyAdded: false, sprintId: 'sprint', route: '/app/career-sprint' }),
    );
    component.startSprint(action);
    expect(component.sprintStates['z'].success).toBe(true);
  });
  it('prevents preview, legacy and missing-context handoffs', () => {
    const action = component.allCards[0];
    component.isPreviewMode = true;
    component.startSprint(action);
    component.isPreviewMode = false;
    component.result!.cacheMetadata = {};
    component.startSprint(action);
    expect(rec.handoffToSprint).not.toHaveBeenCalled();
  });
});
