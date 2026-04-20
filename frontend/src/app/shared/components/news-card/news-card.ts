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
  private readonly fallbackImage =
    'https://images.unsplash.com/photo-1518773553398-650c184e0bb3?auto=format&fit=crop&w=1200&q=80';

  @Input({ required: true }) news!: NewsItem;
  @Input() bookmarked = false;
  @Input() readLater = false;
  @Output() bookmarkToggle = new EventEmitter<string>();
  @Output() readLaterToggle = new EventEmitter<string>();

  get imageSrc(): string {
    const raw = String(this.news?.image || '').trim();
    if (!raw) return this.fallbackImage;
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith('//')) return `${globalThis.location?.protocol || 'https:'}${raw}`;
    return this.fallbackImage;
  }

  onBookmarkToggle(): void {
    this.bookmarkToggle.emit(this.news.url);
  }

  onReadLaterToggle(): void {
    this.readLaterToggle.emit(this.news.url);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = this.fallbackImage;
  }
}
