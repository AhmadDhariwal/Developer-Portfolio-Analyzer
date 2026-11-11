import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { SupportComponent } from './support';
import { SupportService } from '../../shared/services/support.service';
import { SupportTicketDraft } from './components/support-models';

describe('SupportComponent', () => {
  let component: SupportComponent;
  let supportServiceMock: {
    getMyTickets: ReturnType<typeof vi.fn>;
    createTicket: ReturnType<typeof vi.fn>;
    deleteTicket: ReturnType<typeof vi.fn>;
    addReply: ReturnType<typeof vi.fn>;
  };

  const emptyList = { tickets: [], pagination: { page: 1, limit: 5, total: 0, pages: 1 } };

  beforeEach(async () => {
    supportServiceMock = {
      getMyTickets: vi.fn().mockReturnValue(of(emptyList)),
      createTicket: vi.fn().mockReturnValue(of({ message: 'ok', ticket: {} })),
      deleteTicket: vi.fn().mockReturnValue(of({ message: 'ok' })),
      addReply: vi.fn().mockReturnValue(of({ message: 'ok', ticket: {} })),
    };

    await TestBed.configureTestingModule({
      imports: [SupportComponent],
      providers: [{ provide: SupportService, useValue: supportServiceMock }],
    }).compileComponents();

    const fixture = TestBed.createComponent(SupportComponent);
    component = fixture.componentInstance;
    component.ngOnInit();
  });

  const draft: SupportTicketDraft = {
    category: 'account_issue',
    priority: 'high',
    subject: 'Subject text',
    message: 'Message text',
    replyToEmail: 'me@example.com',
  };

  it('requests my-tickets with a page size of 5', () => {
    expect(supportServiceMock.getMyTickets).toHaveBeenCalledWith(1, 5);
  });

  it('initializes with isLoadingTickets true and sets to false after tickets load', () => {
    const fresh = TestBed.createComponent(SupportComponent).componentInstance;
    expect(fresh.isLoadingTickets).toBe(true);
    expect(component.isLoadingTickets).toBe(false);
  });

  it('sends only replyToEmail plus the fixed field list (no contactEmail/email)', () => {
    component.submitSupportTicket(draft);
    const payload = supportServiceMock.createTicket.mock.calls[0][0];
    expect(payload.replyToEmail).toBe('me@example.com');
    expect('contactEmail' in payload).toBe(false);
    expect('email' in payload).toBe(false);
    expect(Object.keys(payload).sort()).toEqual(
      [
        'browserInfo',
        'category',
        'message',
        'priority',
        'replyToEmail',
        'sourcePage',
        'subject',
      ].sort(),
    );
  });

  it('retains all entered fields on submit error', () => {
    supportServiceMock.createTicket.mockReturnValue(
      throwError(() => ({ error: { message: 'Too many requests.' } })),
    );
    component.submitSupportTicket(draft);

    expect(component.draft).toEqual(draft);
    expect(component.supportError).toBe('Too many requests.');
  });

  it('clears subject/message but keeps category/priority/replyToEmail after a 201', () => {
    component.submitSupportTicket(draft);

    expect(component.draft.subject).toBe('');
    expect(component.draft.message).toBe('');
    expect(component.draft.category).toBe('account_issue');
    expect(component.draft.priority).toBe('high');
    expect(component.draft.replyToEmail).toBe('me@example.com');
  });

  it('does not submit twice while a submit is in flight', () => {
    component.isSubmittingTicket = true;
    component.submitSupportTicket(draft);
    expect(supportServiceMock.createTicket).not.toHaveBeenCalled();
  });
});
