import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiBadgeComponent } from './ui-badge.component';

describe('UiBadgeComponent', () => {
  let component: UiBadgeComponent;
  let fixture: ComponentFixture<UiBadgeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiBadgeComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiBadgeComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should apply variant and size classes', () => {
    component.variant = 'success';
    component.size = 'sm';
    fixture.detectChanges();

    const badge = fixture.nativeElement.querySelector('.ui-badge');
    expect(badge.classList.contains('success')).toBe(true);
    expect(badge.classList.contains('sm')).toBe(true);
  });

  it('should render dot indicator when dot is true', () => {
    component.dot = true;
    fixture.detectChanges();

    const dot = fixture.nativeElement.querySelector('.badge-dot');
    expect(dot).toBeTruthy();
  });

  it('should emit removed event when remove button is clicked', () => {
    component.removable = true;
    fixture.detectChanges();

    let removedEmitted = false;
    component.removed.subscribe(() => (removedEmitted = true));

    const removeBtn = fixture.nativeElement.querySelector('.badge-remove-btn');
    removeBtn.click();

    expect(removedEmitted).toBe(true);
  });
});
