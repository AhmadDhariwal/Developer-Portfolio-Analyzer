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
  @Input() bookmarkLoading = false;
  @Input() readLaterLoading = false;
  @Output() bookmarkToggle = new EventEmitter<NewsItem>();
  @Output() readLaterToggle = new EventEmitter<NewsItem>();

  get imageSrc(): string {
    const raw = String(this.news?.image || '').trim();
    if (!raw) return this.fallbackImage;
    if (/^https?:\/\//i.test(raw) || raw.startsWith('data:') || raw.startsWith('blob:')) return raw;
    if (raw.startsWith('//')) return `${globalThis.location?.protocol || 'https:'}${raw}`;
    return this.fallbackImage;
  }

  get scoreWidth(): number {
    return Math.max(12, Math.min(100, Math.round(Number(this.news?.rankScore || 0))));
  }

  get sourceTone(): string {
    const source = String(this.news?.source || '').toLowerCase();
    if (source.includes('hacker')) return 'source-hn';
    if (source.includes('gnews')) return 'source-gnews';
    if (source.includes('dev.to')) return 'source-devto';
    if (source.includes('reddit')) return 'source-reddit';
    return 'source-newsapi';
  }

  get relevanceReasons(): string[] {
    return Array.isArray(this.news?.relevanceReasons) ? this.news.relevanceReasons.filter(Boolean).slice(0, 2) : [];
  }

  get signalPills(): string[] {
    const skills = Array.isArray(this.news?.relatedSkills) ? this.news.relatedSkills : [];
    const gaps = Array.isArray(this.news?.relatedSkillGaps) ? this.news.relatedSkillGaps : [];
    const demand = Array.isArray(this.news?.demandTags) ? this.news.demandTags : [];
    return [...skills.slice(0, 2), ...gaps.slice(0, 1), ...demand.slice(0, 2)].filter(Boolean).slice(0, 5);
  }

  onBookmarkToggle(): void {
    if (this.bookmarkLoading) return;
    this.bookmarkToggle.emit(this.news);
  }

  onReadLaterToggle(): void {
    if (this.readLaterLoading) return;
    this.readLaterToggle.emit(this.news);
  }

  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    img.src = this.fallbackImage;
  }
}
