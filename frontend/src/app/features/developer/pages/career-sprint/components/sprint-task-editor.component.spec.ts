import { TestBed } from '@angular/core/testing';
import { SprintTaskEditorComponent } from './sprint-task-editor.component';
import { sprintFixture } from '../testing/sprint.fixture';

describe('Sprint task editor', () => {
  it('keeps handoff annotations intact when editing a task title or description', () => {
    const fixture = TestBed.createComponent(SprintTaskEditorComponent);
    fixture.componentRef.setInput('zone', 'Asia/Karachi');
    const suffix =
      '\nCourse: original-course\nSkill: TypeScript\nhttps://www.udemy.com/course/fixture/';
    fixture.componentRef.setInput('task', {
      ...sprintFixture().tasks[0],
      description: 'Study the course.' + suffix,
    });
    fixture.detectChanges();
    const editor = fixture.componentInstance;
    expect(editor.form.description).toBe('Study the course.');
    editor.form.description = 'Practice the course examples.';
    editor.form.title = 'Changed title';
    const emit = vi.spyOn(editor.saved, 'emit');
    editor.submit();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        title: sprintFixture().tasks[0].title,
        description: 'Practice the course examples.' + suffix,
      }),
    );
  });
  it('edits calendar dates in the pinned zone and emits only editable fields', () => {
    const fixture = TestBed.createComponent(SprintTaskEditorComponent);
    fixture.componentRef.setInput('zone', 'Asia/Karachi');
    fixture.componentRef.setInput('task', sprintFixture().tasks[0]);
    fixture.detectChanges();
    const editor = fixture.componentInstance;
    expect(editor.form.startDate).toBe('2026-10-16');
    const emit = vi.spyOn(editor.saved, 'emit');
    editor.submit();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Test the authentication flow', startDate: '2026-10-16' }),
    );
    expect(emit.mock.calls[0][0]).not.toHaveProperty('isCompleted');
    expect(emit.mock.calls[0][0]).not.toHaveProperty('_id');
  });
  it('retains unsaved input across pending/error states and rejects invalid date ranges', () => {
    const fixture = TestBed.createComponent(SprintTaskEditorComponent);
    fixture.componentRef.setInput('task', null);
    fixture.detectChanges();
    const editor = fixture.componentInstance;
    editor.form.title = 'Keep my input';
    fixture.componentRef.setInput('busy', true);
    fixture.detectChanges();
    fixture.componentRef.setInput('busy', false);
    fixture.detectChanges();
    expect(editor.form.title).toBe('Keep my input');
    editor.form.startDate = '2026-10-20';
    editor.form.endDate = '2026-10-19';
    const emit = vi.spyOn(editor.saved, 'emit');
    editor.submit();
    expect(emit).not.toHaveBeenCalled();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('fieldset').disabled).toBe(true);
  });
});
