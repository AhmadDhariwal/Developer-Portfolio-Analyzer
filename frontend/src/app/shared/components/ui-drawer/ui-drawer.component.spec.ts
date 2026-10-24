import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiDrawerComponent } from './ui-drawer.component';

describe('UiDrawerComponent', () => {
  let component: UiDrawerComponent;
  let fixture: ComponentFixture<UiDrawerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiDrawerComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiDrawerComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.title = 'Filters Panel';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render dialog panel when isOpen is true', () => {
    component.title = 'Filters Panel';
    component.isOpen = true;
    fixture.detectChanges();

    const dialog = fixture.nativeElement.querySelector('[role="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('should emit close when closeDrawer is called', () => {
    component.isOpen = true;
    fixture.detectChanges();

    let closed = false;
    component.close.subscribe(() => (closed = true));

    component.closeDrawer();
    expect(closed).toBe(true);
  });
});
