import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnChanges,
  Output,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NewsItem } from '../../models/news.model';
import { NEWS_SKILL_EVIDENCE_LABELS, safeNewsUrl } from '../../utils/news-presentation';

@Component({
  selector: 'app-news-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './news-card.html',
  styleUrl: './news-card.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewsCardComponent implements OnChanges {
  readonly evidenceLabels = NEWS_SKILL_EVIDENCE_LABELS;
  @Input({ required: true }) news!: NewsItem;
  @Input() bookmarked = false;
  @Input() personalized = true;
  @Input() readLater = false;
  @Input() bookmarkLoading = false;
  @Input() readLaterLoading = false;
  @Output() bookmarkToggle = new EventEmitter<NewsItem>();
  @Output() readLaterToggle = new EventEmitter<NewsItem>();
  imageFailed = false;
  ngOnChanges(changes: SimpleChanges): void {
    if (changes['news']) this.imageFailed = false;
  }
  get imageSrc(): string {
    return this.imageFailed ? '' : safeNewsUrl(this.news.image);
  }
  get articleUrl(): string {
    return safeNewsUrl(this.news.url);
  }
  get attributionUrl(): string {
    return safeNewsUrl(this.news.attributionUrl) || this.articleUrl;
  }
  get scoreWidth(): number {
    return Math.max(0, Math.min(100, this.news.rankScore ?? 0));
  }
  onBookmarkToggle(): void {
    if (!this.bookmarkLoading) this.bookmarkToggle.emit(this.news);
  }
  onReadLaterToggle(): void {
    if (!this.readLaterLoading) this.readLaterToggle.emit(this.news);
  }
}
