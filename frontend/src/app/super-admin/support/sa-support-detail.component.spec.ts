import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SaSupportDetailComponent } from './sa-support-detail.component';
import { SupportService } from '../../shared/services/support.service';

describe('SaSupportDetailComponent', () => {
  let component: SaSupportDetailComponent;
  let supportServiceMock: {
    adminGetTicket: ReturnType<typeof vi.fn>;
    adminUpdateStatus: ReturnType<typeof vi.fn>;
    adminReply: ReturnType<typeof vi.fn>;
  };

  const ticket = {
    _id: 't1',
    name: 'Jane Dev',
    email: 'user@example.com',
    category: 'bug',
    priority: 'high',
    status: 'open',
    subject: 'Broken page',
    message: 'The page crashes.',
    replies: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  function build() {
    const fixture = TestBed.createComponent(SaSupportDetailComponent);
    component = fixture.componentInstance;
    component.ticketId = 't1';
    component.ngOnInit();
  }

  beforeEach(async () => {
    supportServiceMock = {
      adminGetTicket: vi.fn().mockReturnValue(of({ ticket })),
      adminUpdateStatus: vi.fn().mockReturnValue(of({ ticket: { ...ticket, status: 'resolved' } })),
      adminReply: vi.fn().mockReturnValue(of({ ticket: { ...ticket } })),
    };

    await TestBed.configureTestingModule({
      imports: [SaSupportDetailComponent],
      providers: [{ provide: SupportService, useValue: supportServiceMock }],
    }).compileComponents();
  });

  it('loads the ticket on init and seeds the status select', () => {
    build();
    expect(supportServiceMock.adminGetTicket).toHaveBeenCalledWith('t1');
    expect(component.ticket?._id).toBe('t1');
    expect(component.statusValue).toBe('open');
  });

  it('always sends expectedUpdatedAt on a status change', () => {
    build();
    component.statusValue = 'resolved';
    component.onStatusChange();
    expect(supportServiceMock.adminUpdateStatus).toHaveBeenCalledWith(
      't1',
      'resolved',
      '2026-01-01T00:00:00.000Z',
    );
  });

  it('does not issue an update when the status is unchanged', () => {
    build();
    component.statusValue = 'open';
    component.onStatusChange();
    expect(supportServiceMock.adminUpdateStatus).not.toHaveBeenCalled();
  });

  it('shows the stale-write message and re-fetches on a 409', () => {
    build();
    supportServiceMock.adminGetTicket.mockClear();
    supportServiceMock.adminUpdateStatus.mockReturnValue(
      throwError(() => ({ status: 409, error: { message: 'stale' } })),
    );
    component.statusValue = 'resolved';
    component.onStatusChange();

    expect(component.statusError).toBe(
      'This ticket was updated by someone else. Reload and try again.',
    );
    expect(supportServiceMock.adminGetTicket).toHaveBeenCalledTimes(1);
  });

  it('disables the reply box when the 100-reply cap is reached', () => {
    const full = {
      ...ticket,
      replies: Array.from({ length: 100 }, (_, i) => ({
        authorId: 'a',
        authorRole: 'admin' as const,
        body: `r${i}`,
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    };
    supportServiceMock.adminGetTicket.mockReturnValue(of({ ticket: full }));
    build();
    expect(component.replyCapReached).toBe(true);
    component.replyBody = 'blocked';
    component.sendReply();
    expect(supportServiceMock.adminReply).not.toHaveBeenCalled();
  });

  it('sends an admin reply and clears the input', () => {
    build();
    component.replyBody = 'On it';
    component.sendReply();
    expect(supportServiceMock.adminReply).toHaveBeenCalledWith('t1', 'On it');
    expect(component.replyBody).toBe('');
  });
});
