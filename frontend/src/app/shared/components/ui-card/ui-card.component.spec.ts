import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiCardComponent } from './ui-card.component';

describe('UiCardComponent', () => {
  let component: UiCardComponent;
  let fixture: ComponentFixture<UiCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiCardComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiCardComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.title = 'Card Title';
    component.subtitle = 'Card Subtitle';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should display title and subtitle', () => {
    component.title = 'Card Title';
    component.subtitle = 'Card Subtitle';
    fixture.detectChanges();

    const titleEl = fixture.nativeElement.querySelector('h3');
    const subtitleEl = fixture.nativeElement.querySelector('p');

    expect(titleEl.textContent).toContain('Card Title');
    expect(subtitleEl.textContent).toContain('Card Subtitle');
  });

  it('should apply variant classes', () => {
    component.variant = 'glass';
    fixture.detectChanges();

    const card = fixture.nativeElement.querySelector('.ui-card');
    expect(card.classList.contains('glass')).toBe(true);
  });
});
