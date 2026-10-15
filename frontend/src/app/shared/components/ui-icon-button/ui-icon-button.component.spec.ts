import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiIconButtonComponent } from './ui-icon-button.component';

describe('UiIconButtonComponent', () => {
  let component: UiIconButtonComponent;
  let fixture: ComponentFixture<UiIconButtonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiIconButtonComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiIconButtonComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.ariaLabel = 'Close modal';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should set aria-label on button element', () => {
    component.ariaLabel = 'Close modal';
    fixture.detectChanges();
    const button = fixture.nativeElement.querySelector('button');
    expect(button.getAttribute('aria-label')).toBe('Close modal');
  });

  it('should emit clicked event when not disabled', () => {
    component.ariaLabel = 'Close';
    fixture.detectChanges();
    let emitted = false;
    component.clicked.subscribe(() => (emitted = true));

    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(emitted).toBe(true);
  });

  it('should not emit clicked event when disabled', () => {
    component.ariaLabel = 'Close';
    component.disabled = true;
    fixture.detectChanges();

    let emitted = false;
    component.clicked.subscribe(() => (emitted = true));

    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(emitted).toBe(false);
  });
});
