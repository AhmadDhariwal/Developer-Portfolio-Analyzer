import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SupportTicketFormComponent } from './support-ticket-form.component';
import { SupportTicketDraft } from '../support-models';

describe('SupportTicketFormComponent', () => {
  let component: SupportTicketFormComponent;
  let fixture: ComponentFixture<SupportTicketFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SupportTicketFormComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SupportTicketFormComponent);
    component = fixture.componentInstance;
    component.categoryCards = [
      { value: 'bug', title: 'Report a Bug', description: '', icon: '', iconClass: '' },
    ];
    fixture.detectChanges();
  });

  it('flags an invalid reply-to email and blocks submit', () => {
    let emitted: SupportTicketDraft | null = null;
    component.submitTicket.subscribe((d) => (emitted = d));

    component.model = {
      category: 'bug',
      priority: 'low',
      subject: 'x',
      message: 'y',
      replyToEmail: 'not-an-email',
    };
    component.onSubmit();

    expect(component.replyToInvalid).toBe(true);
    expect(emitted).toBeNull();
  });

  it('accepts an empty reply-to email and emits the draft', () => {
    let emitted: SupportTicketDraft | null = null;
    component.submitTicket.subscribe((d) => (emitted = d));

    component.model = {
      category: 'bug',
      priority: 'low',
      subject: 'x',
      message: 'y',
      replyToEmail: '',
    };
    component.onSubmit();

    expect(component.replyToInvalid).toBe(false);
    expect(emitted).not.toBeNull();
    expect(emitted!.replyToEmail).toBe('');
  });

  it('does not emit while submitting (double-submit disable)', () => {
    let count = 0;
    component.submitTicket.subscribe(() => count++);
    component.submitting = true;
    component.model = {
      category: 'bug',
      priority: 'low',
      subject: 'x',
      message: 'y',
      replyToEmail: '',
    };

    component.onSubmit();

    expect(count).toBe(0);
  });

  it('hydrates its model from an incoming draft', () => {
    component.draft = {
      category: 'account_issue',
      priority: 'high',
      subject: 'kept subject',
      message: 'kept message',
      replyToEmail: 'me@example.com',
    };

    expect(component.model.subject).toBe('kept subject');
    expect(component.model.priority).toBe('high');
  });
});
