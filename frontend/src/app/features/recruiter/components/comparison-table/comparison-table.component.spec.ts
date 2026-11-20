import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ComparisonTableComponent } from './comparison-table.component';

describe('ComparisonTableComponent', () => {
  let component: ComparisonTableComponent;
  let fixture: ComponentFixture<ComparisonTableComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ComparisonTableComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(ComparisonTableComponent);
    component = fixture.componentInstance;
  });

  it('renders Unavailable when githubScore is null instead of synthesizing 0%', () => {
    component.items = [
      {
        id: 'cand-1',
        name: 'Elena Rostova',
        stack: 'Full Stack',
        readinessScore: 88,
        githubScore: 91,
        resumeScore: 85,
        consistencyScore: 82,
        growthPotentialScore: 90,
        skills: ['TypeScript', 'Angular'],
      },
      {
        id: 'cand-2',
        name: 'Marcus Vance',
        stack: 'Frontend',
        readinessScore: 76,
        githubScore: null,
        resumeScore: 80,
        consistencyScore: 78,
        growthPotentialScore: 84,
        skills: ['Angular'],
      },
    ];
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Elena Rostova');
    expect(text).toContain('Marcus Vance');
    expect(text).toContain('Unavailable');
    expect(text).toContain('91');
    expect(component.isBest('githubScore', 91)).toBe(true);
    expect(component.isBest('githubScore', null)).toBe(false);
  });
});
