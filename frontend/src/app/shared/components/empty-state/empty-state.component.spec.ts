import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiEmptyStateComponent } from './empty-state.component';

describe('UiEmptyStateComponent', () => {
  let component: UiEmptyStateComponent;
  let fixture: ComponentFixture<UiEmptyStateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiEmptyStateComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiEmptyStateComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should display title and subtitle', () => {
    component.title = 'No repositories found';
    component.subtitle = 'Connect your GitHub account to see repos.';
    fixture.detectChanges();

    const titleEl = fixture.nativeElement.querySelector('.empty-title');
    const descEl = fixture.nativeElement.querySelector('.empty-desc');

    expect(titleEl.textContent).toContain('No repositories found');
    expect(descEl.textContent).toContain('Connect your GitHub account to see repos.');
  });

  it('should apply compact class when compact is true', () => {
    component.compact = true;
    fixture.detectChanges();

    const container = fixture.nativeElement.querySelector('.ui-empty-state');
    expect(container.classList.contains('is-compact')).toBe(true);
  });
});
