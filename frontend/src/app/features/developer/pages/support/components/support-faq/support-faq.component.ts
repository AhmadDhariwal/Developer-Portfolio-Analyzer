import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SupportFaqItem } from '../support-models';

@Component({
  selector: 'app-support-faq',
  standalone: true,
  imports: [CommonModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './support-faq.component.html',
  styleUrl: './support-faq.component.scss',
})
export class SupportFaqComponent {
  @Input() set faqs(value: SupportFaqItem[]) {
    this._faqs = value || [];
  }
  get faqs(): SupportFaqItem[] {
    return this._faqs;
  }

  private _faqs: SupportFaqItem[] = [];

  searchTerm = '';
  showAll = false;
  private openIndexes = new Set<number>();

  get filteredFaqs(): SupportFaqItem[] {
    const term = this.searchTerm.trim().toLowerCase();
    if (!term) return this._faqs;
    return this._faqs.filter(
      (faq) => faq.question.toLowerCase().includes(term) || faq.answer.toLowerCase().includes(term),
    );
  }

  get displayedFaqs(): SupportFaqItem[] {
    const filtered = this.filteredFaqs;
    if (this.searchTerm.trim() || this.showAll) return filtered;
    return filtered.slice(0, 4);
  }

  toggleViewAll(): void {
    this.showAll = !this.showAll;
  }

  isOpen(faq: SupportFaqItem): boolean {
    return this.openIndexes.has(this._faqs.indexOf(faq));
  }

  toggle(faq: SupportFaqItem): void {
    const index = this._faqs.indexOf(faq);
    if (this.openIndexes.has(index)) {
      this.openIndexes.delete(index);
    } else {
      this.openIndexes.add(index);
    }
  }

  panelId(faq: SupportFaqItem): string {
    return `faq-panel-${this._faqs.indexOf(faq)}`;
  }

  buttonId(faq: SupportFaqItem): string {
    return `faq-button-${this._faqs.indexOf(faq)}`;
  }
}
