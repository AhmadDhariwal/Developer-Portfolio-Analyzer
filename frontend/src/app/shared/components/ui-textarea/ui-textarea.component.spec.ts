import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiTextareaComponent } from './ui-textarea.component';

describe('UiTextareaComponent', () => {
  let component: UiTextareaComponent;
  let fixture: ComponentFixture<UiTextareaComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiTextareaComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiTextareaComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.label = 'Description';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should write value via writeValue', () => {
    component.label = 'Description';
    fixture.detectChanges();
    component.writeValue('Long text bio');
    expect(component.value).toBe('Long text bio');
    expect(component.currentLength).toBe(13);
  });

  it('should emit valueChange on input event', () => {
    component.label = 'Description';
    fixture.detectChanges();
    let changed = '';
    component.valueChange.subscribe(val => (changed = val));

    const textarea = fixture.nativeElement.querySelector('textarea');
    textarea.value = 'Updated bio';
    textarea.dispatchEvent(new Event('input'));

    expect(changed).toBe('Updated bio');
  });

  it('should display character count when showCharCount and maxLength are set', () => {
    component.label = 'Description';
    component.maxLength = 100;
    component.showCharCount = true;
    component.value = 'hello';
    fixture.detectChanges();

    const charCount = fixture.nativeElement.querySelector('.char-count');
    expect(charCount).toBeTruthy();
    expect(charCount.textContent).toContain('5 / 100');
  });
});
