import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Course,
  CourseActionState,
  CourseProgressUpdate,
  LearningStatus,
  UserCourseProgress,
  safeCourseUrl,
} from '../../models/course.model';

@Component({
  selector: 'app-course-card',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './course-card.html',
  styleUrl: './course-card.scss',
})
export class CourseCardComponent implements OnChanges {
  @Input({ required: true }) course!: Course;
  @Input() progress: UserCourseProgress | null = null;
  @Input() action: CourseActionState = {};
  @Input() learningReady = false;
  @Output() progressChange = new EventEmitter<CourseProgressUpdate>();
  @Output() remove = new EventEmitter<void>();
  @Output() sprint = new EventEmitter<void>();
  @Output() topicClick = new EventEmitter<string>();
  thumbnailError = false;
  notes = '';
  percent: number | null = null;

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['course']?.previousValue?.id !== this.course.id) this.thumbnailError = false;
    const previous = changes['progress']?.previousValue as UserCourseProgress | null;
    if (
      changes['progress'] &&
      (!previous ||
        previous.notes !== this.progress?.notes ||
        previous.progressPercent !== this.progress?.progressPercent)
    ) {
      this.notes = this.progress?.notes || '';
      this.percent = this.progress?.progressPercent ?? null;
    }
  }
  get externalUrl(): string | null {
    return safeCourseUrl(this.course.url, this.course.platform);
  }
  get thumbnail(): string | null {
    try {
      const url = new URL(this.course.thumbnail || '');
      return url.protocol === 'https:' &&
        ['i.ytimg.com', 'img.youtube.com'].includes(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port
        ? url.href
        : null;
    } catch {
      return null;
    }
  }
  get providerRating(): boolean {
    return (
      this.course.provenance?.ratingSource === 'provider-reviews' &&
      this.course.rating != null &&
      this.course.rating > 0
    );
  }
  get busy(): boolean {
    return !this.learningReady || Boolean(this.action.pending);
  }
  get validProgress(): boolean {
    return (
      this.notes.length <= 2000 &&
      (this.percent == null ||
        (Number.isFinite(this.percent) && this.percent >= 0 && this.percent <= 100))
    );
  }
  changeStatus(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const status = select.value as LearningStatus;
    // Keep the visible status server-confirmed if the request fails.
    select.value = this.progress?.status || 'saved';
    this.progressChange.emit({ status });
  }
  saveDetails(): void {
    if (!this.progress || !this.validProgress || this.busy) return;
    this.progressChange.emit({
      status: this.progress.status,
      notes: this.notes,
      progressPercent: this.percent,
    });
  }
  onTopicClicked(topic: string, event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.topicClick.emit(topic);
  }
  get levelBadgeClass(): string {
    const lvl = (this.course.level || '').toLowerCase();
    if (lvl.includes('begin')) return 'badge-level-beginner';
    if (lvl.includes('inter')) return 'badge-level-intermediate';
    if (lvl.includes('adv')) return 'badge-level-advanced';
    return 'badge-level-general';
  }
}
