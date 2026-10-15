import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiInputComponent } from './ui-input.component';

describe('UiInputComponent', () => {
  let component: UiInputComponent;
  let fixture: ComponentFixture<UiInputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiInputComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiInputComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should write value via ControlValueAccessor', () => {
    fixture.detectChanges();
    component.writeValue('user@example.com');
    expect(component.value).toBe('user@example.com');
  });

  it('should emit valueChange on input event', () => {
    fixture.detectChanges();
    let changedValue = '';
    component.valueChange.subscribe(val => (changedValue = val));

    const input = fixture.nativeElement.querySelector('input');
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));

    expect(changedValue).toBe('hello');
    expect(component.value).toBe('hello');
  });

  it('should toggle password visibility when type is password', () => {
    component.type = 'password';
    fixture.detectChanges();

    expect(component.currentType).toBe('password');
    component.togglePasswordVisibility();
    expect(component.currentType).toBe('text');
  });

  it('should clear value when clearable and clear is invoked', () => {
    component.value = 'test value';
    component.clearable = true;
    fixture.detectChanges();

    component.clear();
    expect(component.value).toBe('');
  });

  it('should display error message and mark aria-invalid', () => {
    component.errorMessage = 'Field is required';
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const errorEl = fixture.nativeElement.querySelector('.error-text');
    expect(errorEl.textContent).toContain('Field is required');
  });
});
