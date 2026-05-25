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

  get starsArray(): number[] {
    return Array.from({ length: 5 });
  }

  get levelClass(): string {
    switch (this.course.level) {
      case 'Beginner':
        return 'level-beginner';
      case 'Intermediate':
        return 'level-intermediate';
      case 'Advanced':
        return 'level-advanced';
      default:
        return 'level-all';
    }
  }

  get platformClass(): string {
    return `platform-${(this.course.platform || 'other').toLowerCase().replace(/\s+/g, '')}`;
  }

  get relevanceLabel(): string {
    const score = Number(this.course.relevanceScore || 0);
    if (score >= 80) return 'Strong Match';
    if (score >= 60) return 'Good Match';
    return 'Relevant';
  }

  onThumbnailError(): void {
    this.thumbnailError = true;
  }

  openCourse(): void {
    if (!this.course.url || this.course.url === '#') {
      return;
    }

    window.open(this.course.url, '_blank', 'noopener,noreferrer');
  }

  formatReviews(count: number): string {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}m`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
  }

  getStarClass(index: number): string {
    const rating = Number(this.course.rating || 0);
    if (index < Math.floor(rating)) return 'star-full';
    if (index < rating && rating % 1 >= 0.25) return 'star-half';
    return 'star-empty';
  }
}
