import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSkeletonComponent } from './ui-skeleton.component';

describe('UiSkeletonComponent', () => {
  let component: UiSkeletonComponent;
  let fixture: ComponentFixture<UiSkeletonComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiSkeletonComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiSkeletonComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should have aria-hidden true for screen readers', () => {
    fixture.detectChanges();
    const container = fixture.nativeElement.querySelector('.ui-skeleton-container');
    expect(container.getAttribute('aria-hidden')).toBe('true');
  });

  it('should render multiple lines when lines input > 1', () => {
    component.variant = 'text';
    component.lines = 3;
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll('.skeleton-item');
    expect(items.length).toBe(3);
  });

  it('should render circular variant correctly', () => {
    component.variant = 'circular';
    fixture.detectChanges();

    const item = fixture.nativeElement.querySelector('.variant-circular');
    expect(item).toBeTruthy();
  });
});
