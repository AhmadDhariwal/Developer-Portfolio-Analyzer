import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SupportFaqComponent } from './support-faq.component';
import { SupportFaqItem } from '../support-models';

describe('SupportFaqComponent', () => {
  let component: SupportFaqComponent;
  let fixture: ComponentFixture<SupportFaqComponent>;

  const faqs: SupportFaqItem[] = [
    { question: 'How do I reset my password?', answer: 'Use the forgot password link.' },
    { question: 'Response time?', answer: 'Within 24-48 hours.' },
    { question: 'Account issue?', answer: 'Select the account category.' },
    { question: 'Statuses?', answer: 'Open, in progress, resolved, closed.' },
    { question: 'Security?', answer: 'We take privacy seriously.' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SupportFaqComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(SupportFaqComponent);
    component = fixture.componentInstance;
    component.faqs = faqs;
    fixture.detectChanges();
  });

  it('toggles a FAQ open and closed (keyboard-operable button click)', () => {
    const target = faqs[0];
    expect(component.isOpen(target)).toBe(false);

    component.toggle(target);
    expect(component.isOpen(target)).toBe(true);

    component.toggle(target);
    expect(component.isOpen(target)).toBe(false);
  });

  it('renders each FAQ header as a button with aria-expanded and aria-controls', () => {
    component.toggle(faqs[0]);
    fixture.detectChanges();

    const button: HTMLButtonElement = fixture.nativeElement.querySelector('button.faq-question');
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-controls')).toBe(component.panelId(faqs[0]));
  });

  it('filters FAQs case-insensitively over question and answer', () => {
    component.searchTerm = 'PASSWORD';
    const filtered = component.filteredFaqs;
    expect(filtered.length).toBe(1);
    expect(filtered[0].question).toContain('password');
  });
});
