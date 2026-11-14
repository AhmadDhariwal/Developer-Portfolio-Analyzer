import { TestBed } from '@angular/core/testing';
import { ScenarioContextPanelComponent } from './scenario-context.component';

describe('Scenario context component', () => {
  it('emits mobile toggle intent without mutating parent-owned state', async () => {
    await TestBed.configureTestingModule({
      imports: [ScenarioContextPanelComponent],
    }).compileComponents();
    const fixture = TestBed.createComponent(ScenarioContextPanelComponent);
    fixture.componentRef.setInput('experienceLevel', 'mid');
    fixture.componentRef.setInput('durationWeeks', 6);
    fixture.componentRef.setInput('projects', []);
    fixture.componentRef.setInput('isLoadingContext', false);
    fixture.componentRef.setInput('showMobileContext', false);
    fixture.componentRef.setInput('context', null);
    fixture.componentRef.setInput('contextCacheHit', false);
    fixture.componentRef.setInput('templates', []);
    fixture.componentRef.setInput('contextCacheLabel', 'Ready');
    const emitted = vi.fn();
    fixture.componentInstance.showMobileContextChange.subscribe(emitted);
    fixture.detectChanges();
    const toggle: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[aria-label="Toggle context panel"]',
    );
    expect(toggle.textContent?.trim()).toBe('Expand');
    toggle.click();
    expect(emitted).toHaveBeenCalledWith(true);
    expect(fixture.componentInstance.showMobileContext).toBe(false);
    fixture.destroy();
  });
});
