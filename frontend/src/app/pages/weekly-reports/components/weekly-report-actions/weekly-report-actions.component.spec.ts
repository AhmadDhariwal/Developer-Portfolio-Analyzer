import { ComponentFixture, TestBed } from '@angular/core/testing';
import { WeeklyReportActionsComponent } from './weekly-report-actions.component';
import { WeeklyReport } from '../../../../shared/services/weekly-report.service';

describe('WeeklyReportActionsComponent', () => {
  let component: WeeklyReportActionsComponent;
  let fixture: ComponentFixture<WeeklyReportActionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [WeeklyReportActionsComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(WeeklyReportActionsComponent);
    component = fixture.componentInstance;
  });

  it('emits generate event when generate button is clicked', () => {
    const emitSpy = vi.spyOn(component.generate, 'emit');
    component.isGenerating = false;
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('.generate-btn');
    button.click();
    expect(emitSpy).toHaveBeenCalled();
  });

  it('emits refresh, downloadPdf, and resendEmail when corresponding buttons are clicked', () => {
    const refreshSpy = vi.spyOn(component.refresh, 'emit');
    const downloadSpy = vi.spyOn(component.downloadPdf, 'emit');
    const resendSpy = vi.spyOn(component.resendEmail, 'emit');

    component.report = {
      _id: 'test-1',
      emailDelivery: { status: 'sent' },
    } as WeeklyReport;
    component.isCurrentWeek = true;
    component.isArchivedVersion = false;
    fixture.detectChanges();

    const buttons = fixture.nativeElement.querySelectorAll('.snapshot-actions button');
    expect(buttons.length).toBe(3);

    buttons[0].click();
    expect(refreshSpy).toHaveBeenCalled();

    buttons[1].click();
    expect(downloadSpy).toHaveBeenCalled();

    buttons[2].click();
    expect(resendSpy).toHaveBeenCalled();
  });
});
