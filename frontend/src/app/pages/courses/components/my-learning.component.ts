import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  EventEmitter,
  Output,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CourseCardComponent } from '../../../shared/components/course-card/course-card';
import { LearningStatus, UserCourseProgress } from '../../../shared/models/course.model';
import { CourseService } from '../../../shared/services/course.service';
import { CourseLearningStore, learningError } from '../services/course-learning.store';

@Component({
  selector: 'app-my-learning',
  standalone: true,
  imports: [CommonModule, FormsModule, CourseCardComponent],
  templateUrl: './my-learning.component.html',
  styleUrl: './my-learning.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyLearningComponent {
  readonly learning = inject(CourseLearningStore);
  private readonly api = inject(CourseService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private request?: Subscription;
  @Output() discover = new EventEmitter<void>();
  status: LearningStatus | '' = '';
  records: UserCourseProgress[] = [];
  loading = false;
  error = '';
  page = 0;
  totalPages = 1;
  total = 0;
  failedPage = 1;

  constructor() {
    effect(() => {
      this.learning.revision();
      untracked(() => this.refresh());
    });
  }
  refreshLearning(): void {
    this.learning.load();
    this.refresh();
  }
  refresh(): void {
    this.load(1);
  }
  changeFilter(): void {
    this.records = [];
    this.total = 0;
    this.page = 0;
    this.load(1);
  }
  load(page: number): void {
    this.request?.unsubscribe();
    this.loading = true;
    this.error = '';
    this.request = this.api
      .getMyLearning(this.status || undefined, page, 10)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.learning.records.update((records) => ({
            ...records,
            ...Object.fromEntries(result.courses.map((record) => [record.courseId, record])),
          }));
          this.records =
            page === 1
              ? result.courses
              : [
                  ...this.records,
                  ...result.courses.filter(
                    (record) =>
                      !this.records.some((existing) => existing.courseId === record.courseId),
                  ),
                ];
          this.page = result.page;
          this.totalPages = result.totalPages;
          this.total = result.total;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: (error) => {
          this.failedPage = page;
          this.error = learningError(error);
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }
  trackRecord(_: number, record: UserCourseProgress): string {
    return record.courseId;
  }
}
