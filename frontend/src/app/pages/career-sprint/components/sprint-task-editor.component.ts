import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SprintTask, SprintTaskInput } from '../../../shared/services/career-sprint.service';
import { calendarKey, taskDescription } from '../utils/sprint-presentation';

@Component({
  selector: 'app-sprint-task-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './sprint-task-editor.component.html',
  styleUrl: './sprint-task-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SprintTaskEditorComponent implements OnChanges {
  @Input() task: SprintTask | null = null;
  @Input() zone: string | null = null;
  @Input() disabled = false;
  @Input() busy = false;
  @Output() saved = new EventEmitter<SprintTaskInput>();
  @Output() cancelled = new EventEmitter<void>();
  form: SprintTaskInput = this.empty();
  sourceDetails = '';
  get courseLinked(): boolean {
    return this.sourceDetails.trimStart().startsWith('Course:');
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['task'] && !changes['zone']) return;
    if (this.task) {
      const { title, points, priority, category } = this.task;
      const { body, sourceDetails } = taskDescription(this.task);
      this.sourceDetails = sourceDetails;
      this.form = {
        title,
        description: body,
        points,
        priority,
        category,
        startDate: calendarKey(this.task.startDate, this.zone),
        endDate: calendarKey(
          this.task.endDate || this.task.deadline || this.task.dueDate,
          this.zone,
        ),
      };
    } else {
      this.form = this.empty();
      this.sourceDetails = '';
    }
  }

  private empty(): SprintTaskInput {
    return {
      title: '',
      description: '',
      points: 3,
      priority: 'medium',
      category: 'learning',
      startDate: '',
      endDate: '',
    };
  }

  get invalidRange(): boolean {
    return Boolean(
      this.form.startDate && this.form.endDate && this.form.startDate > this.form.endDate,
    );
  }

  submit(): void {
    if (this.disabled || this.busy || !this.form.title.trim() || this.invalidRange) return;
    this.saved.emit({
      ...this.form,
      // Course handoffs also use the original title as a duplicate guard.
      title: this.courseLinked && this.task ? this.task.title : this.form.title.trim(),
      description: this.form.description + this.sourceDetails,
      startDate: this.form.startDate || null,
      endDate: this.form.endDate || null,
    });
  }
}
