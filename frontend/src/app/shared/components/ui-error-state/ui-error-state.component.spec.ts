import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiErrorStateComponent } from './ui-error-state.component';

describe('UiErrorStateComponent', () => {
  let component: UiErrorStateComponent;
  let fixture: ComponentFixture<UiErrorStateComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiErrorStateComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiErrorStateComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should have alert role for accessibility', () => {
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.ui-error-state');
    expect(el.getAttribute('role')).toBe('alert');
  });

  it('should emit retry event when retry button clicked', () => {
    fixture.detectChanges();
    let retried = false;
    component.retry.subscribe(() => (retried = true));

    component.onRetry();
    expect(retried).toBe(true);
  });

  it('should display error code when provided', () => {
    component.code = 500;
    fixture.detectChanges();

    const codeBadge = fixture.nativeElement.querySelector('.error-code-badge');
    expect(codeBadge.textContent).toContain('500');
  });
});
