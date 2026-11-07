import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiProgressComponent } from './ui-progress.component';

describe('UiProgressComponent', () => {
  let component: UiProgressComponent;
  let fixture: ComponentFixture<UiProgressComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiProgressComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiProgressComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.value = 60;
    component.max = 100;
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should calculate percentage correctly', () => {
    component.value = 60;
    component.max = 100;
    expect(component.percentage).toBe(60);
  });

  it('should render role progressbar and aria values for bar variant', () => {
    component.value = 60;
    component.max = 100;
    fixture.detectChanges();

    const el = fixture.nativeElement.querySelector('.ui-progress-bar-container');
    expect(el.getAttribute('role')).toBe('progressbar');
    expect(el.getAttribute('aria-valuenow')).toBe('60');
    expect(el.getAttribute('aria-valuemax')).toBe('100');
  });

  it('should render circular variant svg when variant is circle', () => {
    component.variant = 'circle';
    component.value = 75;
    fixture.detectChanges();

    const svg = fixture.nativeElement.querySelector('.progress-circle-svg');
    expect(svg).toBeTruthy();
  });
});
