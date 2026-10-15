import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subscription, expand, reduce } from 'rxjs';
import { CourseService } from '../../../shared/services/course.service';
import {
  CourseActionState,
  CourseProgressUpdate,
  UserCourseProgress,
} from '../../../shared/models/course.model';

export function learningError(error: { status?: number; error?: { message?: string } }): string {
  if (error?.status === 401 || error?.status === 403)
    return 'Your session has expired. Sign in again to continue.';
  return error?.error?.message || 'Learning services are temporarily unavailable. Please retry.';
}

/** Page-scoped, server-confirmed progress shared by both Learning Hub views. */
@Injectable()
export class CourseLearningStore {
  private readonly api = inject(CourseService);
  private readonly destroyRef = inject(DestroyRef);
  private indexRequest?: Subscription;
  readonly records = signal<Record<string, UserCourseProgress>>({});
  readonly actions = signal<Record<string, CourseActionState>>({});
  readonly ready = signal(false);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly announcement = signal('');
  readonly revision = signal(0);

  load(): void {
    this.indexRequest?.unsubscribe();
    this.ready.set(false);
    this.loading.set(true);
    this.error.set('');
    // Read every owned page before deciding whether a discovery result is already saved.
    this.indexRequest = this.api
      .getMyLearning()
      .pipe(
        expand((page) =>
          page.page < page.totalPages ? this.api.getMyLearning(undefined, page.page + 1) : EMPTY,
        ),
        reduce((records, page) => [...records, ...page.courses], [] as UserCourseProgress[]),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: (records) => {
          this.records.set(Object.fromEntries(records.map((record) => [record.courseId, record])));
          this.ready.set(true);
          this.loading.set(false);
        },
        error: (error) => {
          this.error.set(learningError(error));
          this.loading.set(false);
        },
      });
  }

  save(id: string, update: CourseProgressUpdate): void {
    if (!this.ready() || this.actions()[id]?.pending) return;
    this.setAction(id, { pending: true, message: 'Saving…' });
    this.api
      .saveProgress(id, update)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (record) => {
          this.records.update((records) => ({ ...records, [id]: record }));
          this.setAction(id, { message: 'Learning progress saved.' });
          this.changed('Learning progress saved.');
        },
        error: (error) => this.fail(id, error),
      });
  }

  remove(id: string): void {
    if (!this.ready() || this.actions()[id]?.pending) return;
    this.setAction(id, { pending: true, message: 'Removing…' });
    this.api
      .removeProgress(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.records.update((records) => {
            const next = { ...records };
            delete next[id];
            return next;
          });
          this.setAction(id, { message: 'Removed from My Learning.' });
          this.changed('Removed from My Learning. Existing Sprint tasks are unchanged.');
        },
        error: (error) => this.fail(id, error),
      });
  }

  addToSprint(id: string): void {
    if (
      !this.ready() ||
      !this.records()[id] ||
      this.records()[id].status === 'completed' ||
      this.actions()[id]?.pending
    )
      return;
    this.setAction(id, { pending: true, message: 'Adding to Sprint…' });
    this.api
      .addToSprint(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const message = response.alreadyAdded
            ? 'Already in your Career Sprint.'
            : 'Added to your Career Sprint.';
          this.setAction(id, { message, sprintAdded: true });
          this.announcement.set(message);
        },
        error: (error) => this.fail(id, error),
      });
  }

  private changed(message: string): void {
    this.announcement.set(message);
    this.revision.update((value) => value + 1);
  }
  private setAction(id: string, state: CourseActionState): void {
    this.actions.update((actions) => ({
      ...actions,
      [id]: { sprintAdded: actions[id]?.sprintAdded, ...state },
    }));
  }
  private fail(id: string, error: Parameters<typeof learningError>[0]): void {
    const message = learningError(error);
    this.setAction(id, { error: true, message });
    this.announcement.set(message);
  }
}
