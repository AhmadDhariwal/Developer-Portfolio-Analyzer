import { ComponentFixture, TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
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
});
