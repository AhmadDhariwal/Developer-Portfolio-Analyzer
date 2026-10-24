import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiSectionHeaderComponent } from './ui-section-header.component';

describe('UiSectionHeaderComponent', () => {
  let component: UiSectionHeaderComponent;
  let fixture: ComponentFixture<UiSectionHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiSectionHeaderComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UiSectionHeaderComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.title = 'Repository Highlights';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render h2 title and subtitle', () => {
    component.title = 'Repository Highlights';
    component.subtitle = 'Key contributions across top projects.';
    fixture.detectChanges();

    const h2 = fixture.nativeElement.querySelector('h2.section-title');
    const sub = fixture.nativeElement.querySelector('.section-subtitle');

    expect(h2.textContent).toContain('Repository Highlights');
    expect(sub.textContent).toContain('Key contributions across top projects.');
  });
});
