import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiPageHeaderComponent } from './ui-page-header.component';

describe('UiPageHeaderComponent', () => {
  let component: UiPageHeaderComponent;
  let fixture: ComponentFixture<UiPageHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiPageHeaderComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiPageHeaderComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.title = 'Developer Portfolio Analysis';
    component.subtitle = 'Detailed metrics and benchmark insights.';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render h1 title and subtitle', () => {
    component.title = 'Developer Portfolio Analysis';
    component.subtitle = 'Detailed metrics and benchmark insights.';
    fixture.detectChanges();

    const h1 = fixture.nativeElement.querySelector('h1.page-title');
    const sub = fixture.nativeElement.querySelector('.page-subtitle');

    expect(h1.textContent).toContain('Developer Portfolio Analysis');
    expect(sub.textContent).toContain('Detailed metrics and benchmark insights.');
  });

  it('should emit backClicked when back button is clicked', () => {
    component.title = 'Developer Portfolio Analysis';
    component.showBack = true;
    fixture.detectChanges();

    let backEmitted = false;
    component.backClicked.subscribe(() => (backEmitted = true));

    component.onBack();
    expect(backEmitted).toBe(true);
  });
});
