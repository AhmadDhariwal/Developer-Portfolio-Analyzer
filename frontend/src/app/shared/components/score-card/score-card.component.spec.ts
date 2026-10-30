import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScoreCardComponent } from './score-card.component';

describe('ScoreCardComponent', () => {
  let component: ScoreCardComponent;
  let fixture: ComponentFixture<ScoreCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScoreCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(ScoreCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.title = 'Code Quality';
    component.score = 85;
    component.maxScore = 100;
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should calculate percentage correctly', () => {
    component.score = 85;
    component.maxScore = 100;
    expect(component.percentage).toBe(85);
  });

  it('should render progress bar with accessibility attributes', () => {
    component.title = 'Code Quality';
    component.score = 85;
    component.maxScore = 100;
    fixture.detectChanges();

    const progressBar = fixture.nativeElement.querySelector('.progress-bar');
    expect(progressBar.getAttribute('role')).toBe('progressbar');
    expect(progressBar.getAttribute('aria-valuenow')).toBe('85');
    expect(progressBar.getAttribute('aria-valuemax')).toBe('100');
  });

  it('should render correct color class', () => {
    component.color = 'green';
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.score-card');
    expect(card.classList.contains('score-green')).toBe(true);
  });
});
