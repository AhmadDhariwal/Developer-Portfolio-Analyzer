import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiMetricCardComponent } from './ui-metric-card.component';

describe('UiMetricCardComponent', () => {
  let component: UiMetricCardComponent;
  let fixture: ComponentFixture<UiMetricCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiMetricCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiMetricCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.title = 'Total Commits';
    component.value = '1,420';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render title and value', () => {
    component.title = 'Total Commits';
    component.value = '1,420';
    fixture.detectChanges();

    const titleEl = fixture.nativeElement.querySelector('.metric-title');
    const valueEl = fixture.nativeElement.querySelector('.metric-value');

    expect(titleEl.textContent).toContain('Total Commits');
    expect(valueEl.textContent).toContain('1,420');
  });

  it('should render trend when provided', () => {
    component.title = 'Total Commits';
    component.value = '1,420';
    component.trend = 'up';
    component.trendValue = '+15%';
    fixture.detectChanges();

    const trendEl = fixture.nativeElement.querySelector('.metric-trend');
    expect(trendEl).toBeTruthy();
    expect(trendEl.textContent).toContain('+15%');
    expect(trendEl.classList.contains('trend-up')).toBe(true);
  });

  it('should render loading skeleton when loading is true', () => {
    component.title = 'Total Commits';
    component.loading = true;
    fixture.detectChanges();

    const skeleton = fixture.nativeElement.querySelector('.metric-skeleton-value');
    expect(skeleton).toBeTruthy();
  });
});
