import { TestBed } from '@angular/core/testing';
import { InterviewQuestionCardComponent } from './interview-question-card.component';
import { InterviewQuestion } from '../../../shared/models/interview-prep.model';

describe('Interview question presentation', () => {
  const question: InterviewQuestion = {
    question: 'How do closures work?',
    answer: '<img src=x onerror=alert(1)>',
    difficulty: 'hard',
    tags: ['javascript'],
    sourceType: 'verified_seed',
    verificationStatus: 'unverified',
    answerSections: {
      shortAnswer: 'A closure retains lexical scope.',
      example: 'const add = x => y => x + y;',
      commonMistakes: ['Confusing scope and lifetime'],
      interviewTip: 'Explain capture by reference.',
    },
  };
  it('respects explicit unverified status and safely renders structured code', () => {
    const fixture = TestBed.createComponent(InterviewQuestionCardComponent);
    fixture.componentRef.setInput('question', question);
    fixture.detectChanges();
    expect(fixture.componentInstance.verified).toBe(false);
    fixture.nativeElement.querySelector('.answer-toggle').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('code').textContent).toContain('const add');
    expect(fixture.nativeElement.textContent).toContain('not been independently verified');
    expect(fixture.nativeElement.textContent).toContain('Interview tip');
    fixture.destroy();
  });
  it('escapes plain answers and excludes unsafe provenance URLs', () => {
    const fixture = TestBed.createComponent(InterviewQuestionCardComponent);
    fixture.componentRef.setInput('question', {
      ...question,
      answerSections: {},
      sourceMeta: { url: 'javascript:alert(1)' },
    });
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.answer-toggle').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.componentInstance.sourceUrl).toBe('');
    expect(fixture.nativeElement.textContent).toContain('<img');
    fixture.destroy();
  });
});
