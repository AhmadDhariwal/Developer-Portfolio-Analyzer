import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { NewsItem } from '../../models/news.model';

@Component({
  selector: 'app-news-card',
  standalone: true,
  imports: [CommonModule, DatePipe],
  templateUrl: './news-card.html',
  styleUrl: './news-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NewsCardComponent {
  @Input({ required: true }) news!: NewsItem;
  @Input() bookmarked = false;
  @Input() readLater = false;
  @Output() bookmarkToggle = new EventEmitter<string>();
  @Output() readLaterToggle = new EventEmitter<string>();

  onBookmarkToggle(): void {
    this.bookmarkToggle.emit(this.news.url);
  }

  onReadLaterToggle(): void {
    this.readLaterToggle.emit(this.news.url);
  }
}
