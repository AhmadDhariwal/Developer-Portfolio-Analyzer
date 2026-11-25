import { TestBed } from '@angular/core/testing';
import { InterviewAnswerContentComponent } from './interview-answer-content.component';

describe('Practical answer content', () => {
  it('renders headings, ordered procedures, commands and expected output without executing markup', () => {
    const fixture = TestBed.createComponent(InterviewAnswerContentComponent);
    fixture.componentRef.setInput(
      'text',
      '# Verify\n1. Run the documented client\n2. Check the result\n```sh\nclient ping\n# expected: PONG\n```\n<img src=x onerror=alert(1)>',
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h5').textContent).toBe('Verify');
    expect(fixture.nativeElement.querySelectorAll('ol li')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('code').textContent).toContain(
      'client ping\n# expected: PONG',
    );
    expect(fixture.nativeElement.querySelector('img')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('<img');
  });
  it('preserves plain code and handles unclosed fences without losing commands', () => {
    const fixture = TestBed.createComponent(InterviewAnswerContentComponent);
    fixture.componentRef.setInput('code', true);
    fixture.componentRef.setInput('text', 'const a = 1;\nconsole.log(a);');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('code').textContent).toContain('\nconsole.log(a);');
    fixture.componentRef.setInput('text', '```js\nconst b = 2;');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('code').textContent).toContain('const b = 2;');
  });
});
