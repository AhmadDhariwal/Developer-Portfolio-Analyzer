import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSelectComponent } from './ui-select.component';

describe('UiSelectComponent', () => {
  let component: UiSelectComponent;
  let fixture: ComponentFixture<UiSelectComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiSelectComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiSelectComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.options = [{ value: '1', label: 'One' }];
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should write value via writeValue', () => {
    component.options = [{ value: 'opt2', label: 'Opt 2' }];
    fixture.detectChanges();
    component.writeValue('opt2');
    expect(component.value).toBe('opt2');
  });

  it('should emit valueChange on change event', () => {
    component.options = [
      { value: 'opt1', label: 'Option 1' },
      { value: 'opt2', label: 'Option 2' }
    ];
    fixture.detectChanges();

    let changed: string | number = '';
    component.valueChange.subscribe(val => (changed = val));

    const select = fixture.nativeElement.querySelector('select');
    select.value = 'opt1';
    select.dispatchEvent(new Event('change'));

    expect(changed).toBe('opt1');
  });

  it('should render options properly', () => {
    component.options = [
      { value: 'opt1', label: 'Option 1' },
      { value: 'opt2', label: 'Option 2' }
    ];
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelectorAll('option');
    expect(options.length).toBe(2);
  });
});
