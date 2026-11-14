import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RecommendationRowComponent } from './recommendation-row.component';
import { RecommendationCard } from '../../../shared/models/recommendations.model';

const action: RecommendationCard = {
  id: 'recorded-id',
  category: 'learning',
  priority: 'High',
  title: 'Build TypeScript proof',
  description: 'Recorded description',
  reason: 'Recorded reason',
  evidence: ['First fact', 'Second fact'],
  actionableNextStep: 'Build and test an example',
  targetSkill: 'TypeScript',
  confidenceScore: null,
  estimatedImpact: null,
  estimatedEffort: '',
  evidenceStatus: 'CLAIMED_ONLY',
  freshness: 'RECORDED',
  sources: [{ type: 'skillGap', freshness: 'RECORDED' }],
  actionUrl: '/app/courses?skill=TypeScript',
};
describe('Recommendation row presentation', () => {
  let fixture: ComponentFixture<RecommendationRowComponent>;
  let root: HTMLElement;
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RecommendationRowComponent],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(RecommendationRowComponent);
    fixture.componentRef.setInput('card', action);
    fixture.detectChanges();
    root = fixture.nativeElement;
  });
  it('keeps lengthy evidence and reasons in compact disclosures and surfaces the next action', () => {
    expect(root.querySelector('.row-content')?.textContent).toContain(action.actionableNextStep);
    expect(root.querySelector('.row-content')?.textContent).not.toContain(action.reason);
    expect(root.querySelector('details')?.open).toBe(false);
    expect(root.querySelector('details')?.textContent).toContain('Recorded reason');
    expect(root.querySelector('details')?.textContent).toContain('First fact');
    expect(root.querySelector('details')?.textContent).toContain('Second fact');
    expect(root.querySelector('details')?.textContent).toContain('CLAIMED_ONLY');
  });
  it('separates featured reason and next action, preserving each factual observation once', () => {
    fixture.componentRef.setInput('featured', true);
    fixture.componentRef.setInput('rank', 1);
    fixture.detectChanges();
    expect(root.querySelector('.reason')?.textContent).toContain('Recorded reason');
    expect(root.querySelector('.next-step')?.textContent).toContain('Build and test an example');
    expect(root.querySelector('.evidence-preview')?.textContent).toBe('First fact');
    expect(root.querySelectorAll('.evidence-content li').length).toBe(1);
    expect(root.querySelector('.evidence-content li')?.textContent).toBe('Second fact');
  });
  it('uses semantic priority classes with visible labels and preserves source and course routes', () => {
    for (const priority of ['High', 'Medium', 'Low']) {
      fixture.componentRef.setInput('card', { ...action, priority });
      fixture.detectChanges();
      expect(root.querySelector('.priority')?.classList.contains(priority.toLowerCase())).toBe(
        true,
      );
      expect(root.querySelector('.priority')?.textContent).toContain(priority + ' priority');
    }
    expect(root.querySelector('.category')?.textContent).toBe('Skills');
    expect(root.querySelector('.source-action')?.getAttribute('href')).toBe('/app/skill-gap');
    expect(
      root.querySelector('[aria-label="Browse courses for TypeScript"]')?.getAttribute('href'),
    ).toBe('/app/courses?skill=TypeScript');
    expect(action.category).toBe('learning');
  });
  it('keeps distinct valid navigation actions and rejects unsafe URLs', () => {
    fixture.componentRef.setInput('card', {
      ...action,
      actionUrl: '/app/profile',
      actionLabel: 'Review context',
    });
    fixture.detectChanges();
    expect(root.querySelector('a[href="/app/profile"]')?.textContent).toContain('Review context');
    fixture.componentRef.setInput('card', { ...action, actionUrl: 'javascript:alert(1)' });
    fixture.detectChanges();
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    expect(root.querySelector('.source-action')).not.toBeNull();
  });
  it('emits the original card and shows pending, error and success Sprint states accessibly', () => {
    const emit = vi.spyOn(fixture.componentInstance.sprint, 'emit');
    fixture.componentRef.setInput('sprintEnabled', true);
    fixture.detectChanges();
    root.querySelector<HTMLButtonElement>('button')!.click();
    expect(emit).toHaveBeenCalledWith(action);
    fixture.componentRef.setInput('sprintState', {
      loading: true,
      message: 'Adding to Career Sprint…',
      success: false,
    });
    fixture.detectChanges();
    expect(root.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
    fixture.componentRef.setInput('sprintState', {
      loading: false,
      message: 'Refresh before starting.',
      success: false,
    });
    fixture.detectChanges();
    expect(root.querySelector('[role=status]')?.classList.contains('failure')).toBe(true);
    fixture.componentRef.setInput('sprintState', {
      loading: false,
      message: 'Already in your Career Sprint.',
      success: true,
    });
    fixture.detectChanges();
    expect(root.querySelector('button')).toBeNull();
    expect(root.querySelector('.added')?.getAttribute('href')).toBe('/app/career-sprint');
    expect(root.querySelector('[role=status]')?.classList.contains('success')).toBe(true);
  });
});
