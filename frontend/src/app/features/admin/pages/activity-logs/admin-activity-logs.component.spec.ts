import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { vi } from 'vitest';
import { AdminActivityLogsComponent } from './admin-activity-logs.component';
import { ApiService } from '../../../../shared/services/api.service';
import { AuthService } from '../../../../shared/services/auth.service';
import { TenantContextService } from '../../../../shared/services/tenant-context.service';
import { AdminConsoleService } from '../admin-console/admin-console.service';

describe('AdminActivityLogsComponent', () => {
  let fixture: ComponentFixture<AdminActivityLogsComponent>;
  let component: AdminActivityLogsComponent;
  const tenantState$ = new BehaviorSubject({
    organizationId: 'org-1',
    organizationName: 'Nexora Systems',
    role: 'admin',
  });

  const apiSpy = {
    getAuditLogs: vi.fn().mockReturnValue(
      of({
        logs: [
          {
            _id: 'log-1',
            action: 'Updated job posting',
            method: 'PUT',
            route: '/api/recruiter/jobs/1',
            statusCode: 200,
            timestamp: '2026-11-20T10:00:00.000Z',
          },
        ],
        total: 1,
        limit: 20,
        totalPages: 1,
        actionOptions: ['Updated job posting'],
        actorOptions: [],
      }),
    ),
    deleteAuditLog: vi.fn().mockReturnValue(of({ message: 'Archived' })),
  };

  beforeEach(async () => {
    apiSpy.getAuditLogs.mockClear();
    apiSpy.deleteAuditLog.mockClear();

    await TestBed.configureTestingModule({
      imports: [AdminActivityLogsComponent],
      providers: [
        { provide: ApiService, useValue: apiSpy },
        {
          provide: AuthService,
          useValue: { getCurrentUser: () => ({ _id: 'admin-1', role: 'admin' }) },
        },
        {
          provide: TenantContextService,
          useValue: { state$: tenantState$.asObservable() },
        },
        {
          provide: AdminConsoleService,
          useValue: { getTeams: () => of({ teams: [] }) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminActivityLogsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('defaults to a 30-day date range and supports All dates and confirm-dialog archiving', () => {
    expect(component.datePreset).toBe('30d');
    expect(component.from).not.toBe('');
    expect(component.to).not.toBe('');
    expect(component.from <= component.to).toBe(true);

    component.applyDatePreset('all');
    expect(component.from).toBe('');
    expect(component.to).toBe('');
    expect(component.datePreset).toBe('all');

    component.deleteLog(component.logs[0]);
    expect(component.pendingArchiveLog?._id).toBe('log-1');
    component.confirmArchiveLog();
    expect(apiSpy.deleteAuditLog).toHaveBeenCalledWith('log-1');
  });

  it('keeps the detail area present through delayed loading and empty results', async () => {
    type AuditResponse =
      ReturnType<typeof apiSpy.getAuditLogs> extends Observable<infer Value> ? Value : never;
    const response = new Subject<AuditResponse>();
    apiSpy.getAuditLogs.mockReturnValueOnce(response);
    component.applyFilters();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.detail-panel, .detail-placeholder')).not.toBeNull();
    expect(element.querySelector('.pager')).not.toBeNull();
    expect(element.querySelector('.pager-info')?.textContent).toContain('Loading pages');
    expect(
      Array.from(element.querySelectorAll<HTMLButtonElement>('.pager-btn')).every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    response.next({
      logs: [],
      total: 0,
      limit: 20,
      totalPages: 1,
      actionOptions: [],
      actorOptions: [],
    });
    response.complete();
    await fixture.whenStable();
    expect(element.querySelector('.detail-placeholder')).not.toBeNull();
    expect(element.querySelector('.logs-empty')).not.toBeNull();
    expect(element.querySelector('.pager-info')?.textContent).toContain('No pages');
    expect(component.loading).toBe(false);
  });
});
