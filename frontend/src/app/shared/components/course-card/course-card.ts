import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Course, PLATFORM_COLOR_MAP } from '../../models/course.model';

@Component({
  selector: 'app-course-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './course-card.html',
  styleUrl: './course-card.scss'
})
export class CourseCardComponent {
  @Input({ required: true }) course!: Course;

  thumbnailError = false;

  get platformColors() {
    return PLATFORM_COLOR_MAP[this.course.platform] ?? PLATFORM_COLOR_MAP['Udemy'];
  }

  onThumbnailError(): void {
    this.thumbnailError = true;
  }

  get starsArray(): number[] {
    return Array.from({ length: 5 });
  }

  getStarClass(index: number): string {
    const r = this.course.rating;
    if (index < Math.floor(r))        return 'star-full';
    if (index < r && r % 1 >= 0.25)  return 'star-half';
    return 'star-empty';
  }

  get levelClass(): string {
    switch (this.course.level) {
      case 'Beginner':     return 'level-beginner';
      case 'Intermediate': return 'level-intermediate';
      case 'Advanced':     return 'level-advanced';
      default:             return 'level-all';
    }
  }

  get platformClass(): string {
    return `platform-${(this.course.platform || 'other').toLowerCase().replace(/\s+/g, '')}`;
  }

  openCourse(): void {
    if (this.course.url && this.course.url !== '#') {
      window.open(this.course.url, '_blank', 'noopener,noreferrer');
    }
  }

  formatReviews(count: number): string {
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return count.toString();
  }
}
