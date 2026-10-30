import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiModalComponent } from './ui-modal.component';

describe('UiModalComponent', () => {
  let component: UiModalComponent;
  let fixture: ComponentFixture<UiModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiModalComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiModalComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.title = 'Confirm Action';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render dialog when isOpen is true', () => {
    component.isOpen = true;
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('should emit close when closeModal is called', () => {
    component.isOpen = true;
    fixture.detectChanges();

    let closed = false;
    component.close.subscribe(() => (closed = true));

    component.closeModal();
    expect(closed).toBe(true);
  });

  it('should emit close on backdrop click when closeOnBackdrop is true', () => {
    component.isOpen = true;
    fixture.detectChanges();

    let closed = false;
    component.close.subscribe(() => (closed = true));

    const backdrop = fixture.nativeElement.querySelector('.ui-modal-backdrop');
    backdrop.click();

    expect(closed).toBe(true);
  });
});
