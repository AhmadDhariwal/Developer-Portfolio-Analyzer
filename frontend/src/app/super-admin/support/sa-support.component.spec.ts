import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { SaSupportComponent } from './sa-support.component';
import { SupportService } from '../../shared/services/support.service';

describe('SaSupportComponent', () => {
  let component: SaSupportComponent;
  let supportServiceMock: {
    adminGetTickets: ReturnType<typeof vi.fn>;
  };

  const inbox = {
    tickets: [
      {
        _id: 't1',
        email: 'user@example.com',
        subject: 'Cannot log in',
        message: 'I am locked out.',
        category: 'account_issue',
        priority: 'high',
        status: 'open',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, pages: 1 },
  };

  beforeEach(async () => {
    supportServiceMock = {
      adminGetTickets: vi.fn().mockReturnValue(of(inbox)),
    };

    await TestBed.configureTestingModule({
      imports: [SaSupportComponent],
      providers: [{ provide: SupportService, useValue: supportServiceMock }],
    }).compileComponents();

    const fixture = TestBed.createComponent(SaSupportComponent);
    component = fixture.componentInstance;
    component.ngOnInit();
  });

  it('loads the inbox on init with the default sort', () => {
    expect(supportServiceMock.adminGetTickets).toHaveBeenCalledTimes(1);
    const params = supportServiceMock.adminGetTickets.mock.calls[0][0];
    expect(params.page).toBe(1);
    expect(params.limit).toBe(20);
    expect(params.sort).toBe('createdAt_desc');
    expect(component.tickets.length).toBe(1);
    expect(component.total).toBe(1);
  });

  it('applies a status filter and forwards it to the service', () => {
    component.status = 'open';
    component.load(1);
    const params = supportServiceMock.adminGetTickets.mock.calls.at(-1)![0];
    expect(params.status).toBe('open');
  });

  it('omits empty filters and trims the search term', () => {
    component.search = '  login  ';
    component.load(1);
    const params = supportServiceMock.adminGetTickets.mock.calls.at(-1)![0];
    expect(params.search).toBe('login');
    expect(params.category).toBeUndefined();
    expect(params.priority).toBeUndefined();
  });

  it('opens a ticket by id', () => {
    component.open(inbox.tickets[0]);
    expect(component.selectedId).toBe('t1');
  });

  it('reloads the current page when a ticket is updated', () => {
    component.page = 2;
    component.onTicketUpdated();
    const params = supportServiceMock.adminGetTickets.mock.calls.at(-1)![0];
    expect(params.page).toBe(2);
  });
});
