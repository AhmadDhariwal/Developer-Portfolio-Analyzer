import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiButtonComponent } from './ui-button.component';

describe('UiButtonComponent', () => {
  let component: UiButtonComponent;
  let fixture: ComponentFixture<UiButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiButtonComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiButtonComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should emit clicked event when button is clicked and not disabled', () => {
    fixture.detectChanges();
    let clicked = false;
    component.clicked.subscribe(() => (clicked = true));

    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(clicked).toBe(true);
  });

  it('should not emit clicked event when disabled', () => {
    component.disabled = true;
    fixture.detectChanges();

    let clicked = false;
    component.clicked.subscribe(() => (clicked = true));

    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(clicked).toBe(false);
  });

  it('should apply variant and size classes', () => {
    component.variant = 'outline';
    component.size = 'lg';
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('button');
    expect(button.classList.contains('outline')).toBe(true);
    expect(button.classList.contains('lg')).toBe(true);
  });

  it('should show spinner when loading is true', () => {
    component.loading = true;
    fixture.detectChanges();

    const spinner = fixture.nativeElement.querySelector('.spinner');
    expect(spinner).toBeTruthy();
  });
});
