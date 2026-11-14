import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UiPageHeaderComponent } from './ui-page-header.component';

@Component({
  standalone: true,
  imports: [UiPageHeaderComponent],
  template: `
    <app-ui-page-header
      title="Resume Analyzer"
      subtitle="Evidence-based parsing, deterministic quality scoring, and AI advisory recommendations."
    >
      <div page-actions class="header-actions">
        <button type="button">Download Report</button>
        <button type="button">Refresh Analysis</button>
      </div>
    </app-ui-page-header>
  `,
})
class TestHostWithActionsComponent {}

describe('UiPageHeaderComponent', () => {
  let component: UiPageHeaderComponent;
  let fixture: ComponentFixture<UiPageHeaderComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UiPageHeaderComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(UiPageHeaderComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    component.title = 'Developer Portfolio Analysis';
    component.subtitle = 'Detailed metrics and benchmark insights.';
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('should render h1 title and subtitle', () => {
    component.title = 'Developer Portfolio Analysis';
    component.subtitle = 'Detailed metrics and benchmark insights.';
    fixture.detectChanges();

    const h1 = fixture.nativeElement.querySelector('h1.page-title');
    const sub = fixture.nativeElement.querySelector('.page-subtitle');

    expect(h1.textContent).toContain('Developer Portfolio Analysis');
    expect(sub.textContent).toContain('Detailed metrics and benchmark insights.');
  });

  it('should emit backClicked when back button is clicked', () => {
    component.title = 'Developer Portfolio Analysis';
    component.showBack = true;
    fixture.detectChanges();

    let backEmitted = false;
    component.backClicked.subscribe(() => (backEmitted = true));

    component.onBack();
    expect(backEmitted).toBe(true);
  });

  it('should project page actions alongside title and subtitle inside header-main-row', () => {
    const hostFixture = TestBed.createComponent(TestHostWithActionsComponent);
    hostFixture.detectChanges();

    const mainRow = hostFixture.nativeElement.querySelector('.header-main-row') as HTMLElement;
    const titleCluster = mainRow?.querySelector('.title-cluster') as HTMLElement;
    const actionsSlot = mainRow?.querySelector('.actions-slot') as HTMLElement;

    expect(mainRow).toBeTruthy();
    expect(titleCluster.textContent).toContain('Resume Analyzer');
    expect(titleCluster.textContent).toContain(
      'Evidence-based parsing, deterministic quality scoring, and AI advisory recommendations.',
    );
    expect(actionsSlot.querySelectorAll('button').length).toBe(2);
  });
});
